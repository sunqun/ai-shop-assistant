/**
 * 购物任务（Shopping Task）业务编排层。
 *
 * 负责把 shopping-task-store 提供的"存取与原子状态迁移"原语组织成完整业务流程：
 *   - createShoppingTask：创建任务（前置校验 AI 下单授权）
 *   - prepare：运行 ReAct 准备商品与报价（搜索 → 选品 → 加购 → 报价）
 *   - commitOrder：在取得提交权后真正下单（消费库存预留）
 *   - finishCancellation：取消后生成支付短链
 *   - actOnShoppingTask：统一动作入口，在持锁状态下做状态机迁移
 *
 * 核心约束：所有状态迁移都发生在 updateTask 持有的行锁事务内；事务内不调用模型/业务工具，
 * 真正耗时的模型调用与下单在锁外执行，通过 operationToken 抢占与释放保证互斥。
 */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/repository/db";
import { runShoppingReAct } from "../agent/auto-shopping";
import { submitAiOrder, OrderServiceError } from "@/lib/repository/order-service";
import { createPaymentLink } from "@/lib/repository/payment-link-service";
import type { DialogueSnapshot } from "@/lib/intent/type";
import { REVIEW_LEASE_MS } from "@/lib/reviews/types";
import { CANCELLABLE_PHASES, TERMINAL_PHASES, type ShoppingTask } from "./shopping-task-types";
import {
  createTask,
  getTask,
  updateTask,
  taskView,
  isOperationStale,
  ShoppingTaskError,
  type TaskRecord,
} from "./shopping-task-store";

// 自动流程在报价完成后等待的延时，前端到期后再 advance，服务端会二次校验真实截止时间。
const SUBMISSION_DELAY_MS = 3000;

// 释放任务当前持有的操作令牌，表示本次耗时操作已结束。
function release(task: TaskRecord) {
  task.operationToken = null;
  task.operationStartedAt = null;
}

// 创建购物任务：先校验用户已完成 AI 下单授权，再写入任务并返回前端视图。
export async function createShoppingTask(input: {
  userid: string;
  query: string;
  idempotencyKey: string;
  dialogue?: DialogueSnapshot;
}): Promise<ShoppingTask> {
  const [users] = await getDbPool().query<RowDataPacket[]>(
    "SELECT is_authorized FROM users WHERE userid = ?",
    [input.userid]
  );
  if (!users[0] || !Boolean(users[0].is_authorized))
    throw new ShoppingTaskError(
      "AUTHORIZATION_REQUIRED",
      "请先完成 AI 下单授权后使用购物流程。",
      403
    );
  return taskView(
    await createTask({
      ...input,
      data: input.dialogue ? { dialogue: input.dialogue } : undefined,
    })
  );
}

// 准备阶段：运行 ReAct，让模型搜索商品、选品、加入购物车（锁库存）并生成报价。
// 模型只准备报价，实际下单由提交屏障控制。
async function prepare(userid: string, taskId: string, token: string, task: TaskRecord) {
  let outcome: Awaited<ReturnType<typeof runShoppingReAct>> | undefined;
  try {
    outcome = await runShoppingReAct({
      userid,
      query: task.query,
      dialogue: task.data.dialogue,
      control: {
        shoppingTaskId: taskId,
        signal: AbortSignal.timeout(90_000),
        cartIdempotencyKey: `shopping:${taskId}:cart`,
        // 每个工具真正执行前，先检查任务是否仍属于本次操作、是否已被取消。
        beforeTool: async (phase) => {
          await updateTask(userid, taskId, (current) => {
            if (current.operationToken !== token || current.phase === "cancel_pending") {
              const error = new Error("Shopping task canceled or no longer owned");
              error.name = "AbortError";
              throw error;
            }
            if (phase) current.phase = phase;
          });
        },
        // 工具产出（商品/报价等）写回任务数据，供前端轮询与后续下单使用。
        onProgress: async (data) => {
          await updateTask(userid, taskId, (current) => {
            if (current.operationToken === token) current.data = { ...current.data, ...data };
          });
        },
      },
    });
  } catch (error) {
    // 准备被取消或中断时仅记录日志，最终状态在下方根据快照收敛。
    console.warn("shopping task preparation stopped", {
      taskId,
      type: error instanceof Error ? error.name : "unknown",
    });
  }
  const prepared = await updateTask(userid, taskId, (current) => {
    // 令牌已不匹配（被取消/抢占）则不再推进。
    if (current.operationToken !== token) return;
    release(current);
    // 已进入取消分支时保持取消状态，由 finishCancellation 收尾。
    if (current.phase === "cancel_pending") return;
    if (outcome?.status === "needs_clarification" || current.data.clarification) {
      // 需求不明确，进入澄清终态，不再自动推进。
      current.phase = "needs_clarification";
      current.commitAfter = null;
      current.data.clarification = outcome?.message ?? current.data.clarification;
    } else if (current.data.quote && current.data.product) {
      const needsAcceptance = !!current.data.differences?.length;
      current.phase = needsAcceptance ? "awaiting_confirmation" : "ready_to_order";
      current.commitAfter = needsAcceptance
        ? null
        : new Date(Date.now() + SUBMISSION_DELAY_MS).toISOString();
    } else {
      current.phase = "failed";
      current.data.error =
        current.data.error ??
        outcome?.message ??
        "助手未能完成商品与报价准备，请重新发起购物需求。";
    }
  });
  // 若准备期间被取消且无在途操作，则补跑取消收尾。
  if (prepared.phase === "cancel_pending" && !prepared.operationToken)
    await finishCancellation(userid, taskId);
}

// 取消收尾：在取消被接受后，用已选商品生成支付短链；没有商品则直接结束为无短链。
async function finishCancellation(userid: string, taskId: string) {
  const token = randomUUID();
  let acquired = false;
  const task = await updateTask(userid, taskId, (current) => {
    // 仅在 cancel_pending 且无其他操作占用时接管本次收尾。
    if (current.phase !== "cancel_pending" || current.operationToken) return;
    if (!current.data.product) {
      current.phase = "canceled_no_product";
      return;
    }
    current.phase = "link_creating";
    current.operationToken = token;
    current.operationStartedAt = new Date().toISOString();
    acquired = true;
  });
  if (!acquired || !task.data.product) return;
  try {
    // 使用 taskId 作为稳定的短链 ID，响应丢失或重试不会创建第二条链接。
    const link = await createPaymentLink({
      userid,
      productId: task.data.product.id,
      quantity: task.data.quantity ?? 1,
      linkId: taskId,
    });
    await updateTask(userid, taskId, (current) => {
      if (current.operationToken !== token) return;
      current.data.link = { urlToken: link.urlToken };
      delete current.data.error;
      current.phase = "canceled";
      release(current);
    });
  } catch {
    await updateTask(userid, taskId, (current) => {
      if (current.operationToken !== token) return;
      current.phase = "canceled_link_failed";
      current.data.error = "已停止直接下单，但支付短链生成失败，请重试生成。";
      release(current);
    });
  }
}

// 提交订单：消费库存预留并创建订单；成功/失败分别收敛任务状态。
async function commitOrder(userid: string, taskId: string, token: string, task: TaskRecord) {
  const quote = task.data.quote?.quote;
  if (!quote) throw new ShoppingTaskError("QUOTE_REQUIRED", "请先生成有效报价。");
  try {
    // 幂等键按任务派生，重试/恢复不会重复下单。
    const order = await submitAiOrder({
      userid,
      cartVersion: quote.cartVersion,
      quoteId: quote.quoteId,
      idempotencyKey: `shopping:${taskId}:order`,
    });
    await updateTask(userid, taskId, (current) => {
      if (current.operationToken !== token) return;
      current.data.order = order;
      delete current.data.error;
      current.phase = "ordered";
      release(current);
    });
  } catch (error) {
    await updateTask(userid, taskId, (current) => {
      if (current.operationToken !== token) return;
      if (error instanceof OrderServiceError) {
        // 已知业务错误：明确失败，提示用户重新获取报价。
        current.phase = "failed";
        current.data.errorCode = error.code;
        const messages: Record<string, string> = {
          AUTHORIZATION_REQUIRED: "请先完成 AI 下单授权。",
          OUT_OF_STOCK: "库存不足，本次下单已终止，请重新选择商品。",
          CART_RESERVATION_EXPIRED: "库存预留已到期，本次下单未完成，请重新核验库存。",
          QUOTE_EXPIRED: "报价已失效，价格或优惠可能已变化，请获取并核对新报价后继续。",
          CART_VERSION_CONFLICT: "购物车已变化，本次下单未完成，请重新获取报价。",
        };
        current.data.error = messages[error.code] ?? "订单未能创建，请重新核对商品、库存和报价。";
      } else {
        // 包括提交成功但任务状态写回失败，不能视为未下单；同键核对恢复。
        current.phase = "reconciling_result";
        current.data.error = "订单结果暂不确定，请核对原任务，勿重复购买。";
      }
      release(current);
    });
  }
}

export type ShoppingTaskAction =
  "advance" | "cancel" | "confirm" | "retry-link" | "recover" | "resume-after-reviews";

// 任务动作统一入口：在持锁事务内完成状态机迁移，锁外执行对应的耗时操作。
export async function actOnShoppingTask(
  userid: string,
  taskId: string,
  action: ShoppingTaskAction,
  confirmation?: { cartVersion: number; quoteId: string }
): Promise<ShoppingTask> {
  const token = randomUUID();
  let operation: "prepare" | "commit" | "cancel" | null = null;
  const task = await updateTask(userid, taskId, (current) => {
    if (action === "resume-after-reviews") {
      if (!current.data.reviewHold || !CANCELLABLE_PHASES.includes(current.phase)) return;
      const progress = current.data.reviewProgress;
      if (
        progress?.operationToken &&
        progress.operationStartedAt &&
        Date.now() - Date.parse(progress.operationStartedAt) < REVIEW_LEASE_MS
      )
        throw new ShoppingTaskError(
          "REVIEWS_STILL_RUNNING",
          "评论分析仍在处理中，完成后可继续自动流程。"
        );
      current.data.reviewHold = false;
      if (progress) {
        progress.operationToken = null;
        progress.operationStartedAt = null;
      }
      if (current.phase === "ready_to_order")
        current.commitAfter = new Date(Date.now() + SUBMISSION_DELAY_MS).toISOString();
      return;
    }
    // 取消：已处于取消相关状态则幂等返回；仅可取消阶段可进入 cancel_pending。
    if (action === "cancel") {
      if (
        [
          "cancel_pending",
          "link_creating",
          "canceled",
          "canceled_no_product",
          "canceled_link_failed",
        ].includes(current.phase)
      )
        return;
      if (!CANCELLABLE_PHASES.includes(current.phase))
        throw new ShoppingTaskError(
          "TASK_NOT_CANCELLABLE",
          "已进入创建订单阶段或任务已结束，无法取消。"
        );
      current.phase = "cancel_pending";
      if (!current.operationToken) operation = "cancel";
      return;
    }
    // 重试短链：仅取消后短链失败的任务可重试，重新进入取消收尾。
    if (action === "retry-link") {
      if (current.phase === "canceled" || current.phase === "link_creating") return;
      if (current.phase !== "canceled_link_failed")
        throw new ShoppingTaskError("TASK_NOT_RETRYABLE", "当前任务无需重试生成短链。");
      current.phase = "cancel_pending";
      operation = "cancel";
      return;
    }
    // 终态任务不再推进任何动作。
    if (TERMINAL_PHASES.includes(current.phase)) return;
    if (current.operationToken) {
      // 有进行中的操作：未超时则忽略本次请求；超时后按阶段决定恢复或失败。
      if (!isOperationStale(current)) return;
      // 不重放中断的准备步骤；订单必须按原幂等键恢复。
      if (["committing", "reconciling_result"].includes(current.phase)) {
        if (action !== "recover") return;
      } else if (current.phase === "link_creating") {
        current.phase = "cancel_pending";
      } else if (current.phase !== "cancel_pending") {
        current.phase = "failed";
        current.data.error = "任务执行已中断，请重新发起。此任务未进入创建订单阶段。";
        release(current);
        return;
      }
      release(current);
    }
    // 进入取消收尾。
    if (current.phase === "cancel_pending") {
      operation = "cancel";
      return;
    }
    // 正常推进分支：
    //   1) queued + advance → 准备（进入 searching）
    //   2) 有差异的 awaiting_confirmation + confirm → 提交
    //   3) 无差异的 ready_to_order + advance（到期后）→ 提交
    //   4) committing/reconciling_result + recover → 按原幂等键恢复提交
    if (current.phase === "queued" && action === "advance") {
      operation = "prepare";
      current.phase = "searching";
    } else if (action === "confirm" && current.phase === "awaiting_confirmation") {
      const quote = current.data.quote?.quote;
      if (
        !quote ||
        !current.data.product ||
        confirmation?.quoteId !== quote.quoteId ||
        confirmation?.cartVersion !== quote.cartVersion
      )
        throw new ShoppingTaskError("QUOTE_MISMATCH", "确认信息与任务报价不一致，请刷新后重试。");
      current.data.acceptedQuote = {
        quoteId: quote.quoteId,
        cartVersion: quote.cartVersion,
        productId: current.data.product!.id,
        quantity: current.data.quantity ?? 1,
        differences: current.data.differences ?? [],
        acceptedAt: new Date().toISOString(),
      };
      operation = "commit";
    } else if (current.phase === "ready_to_order" && action === "advance") {
      if (current.data.differences?.length) {
        current.phase = "awaiting_confirmation";
        current.commitAfter = null;
        return;
      }
      if (current.data.reviewHold) return;
      if (!current.commitAfter || Date.now() < Date.parse(current.commitAfter)) return;
      operation = "commit";
    } else if (
      action === "recover" &&
      ["committing", "reconciling_result"].includes(current.phase)
    ) {
      operation = "commit";
    } else return;
    // 提交动作先把状态迁到 committing，从此刻起拒绝取消。
    if (operation === "commit") {
      const differences = current.data.differences ?? [];
      if (differences.length) {
        const accepted = current.data.acceptedQuote;
        const quote = current.data.quote?.quote;
        const sameDifferences =
          !!accepted &&
          accepted.differences.length === differences.length &&
          differences.every((difference, index) => {
            const previous = accepted.differences[index];
            return (
              previous.requirement === difference.requirement &&
              previous.actual === difference.actual &&
              previous.status === difference.status
            );
          });
        if (
          !accepted ||
          !quote ||
          accepted.quoteId !== quote.quoteId ||
          accepted.cartVersion !== quote.cartVersion ||
          accepted.productId !== current.data.product?.id ||
          accepted.quantity !== (current.data.quantity ?? 1) ||
          !sameDifferences
        )
          throw new ShoppingTaskError(
            "DIFFERENCE_ACCEPTANCE_REQUIRED",
            "当前商品、差异或报价与已确认内容不一致，请重新核对。"
          );
      }
      current.phase = "committing";
    }
    current.operationToken = token;
    current.operationStartedAt = new Date().toISOString();
  });
  // 锁外执行对应的耗时操作，完成后回写结果。
  if (operation === "prepare") await prepare(userid, taskId, token, task);
  else if (operation === "commit") await commitOrder(userid, taskId, token, task);
  else if (operation === "cancel") await finishCancellation(userid, taskId);
  return taskView(await getTask(userid, taskId));
}
