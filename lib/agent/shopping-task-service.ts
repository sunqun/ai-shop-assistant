import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db";
import { runShoppingReAct } from "./auto-shopping";
import { submitAiOrder, OrderServiceError } from "@/lib/order-service";
import { createPaymentLink } from "@/lib/payment-link/payment-link-service";
import {
  CANCELLABLE_PHASES,
  TERMINAL_PHASES,
  type ShoppingMode,
  type ShoppingTask,
} from "./shopping-task-types";
import {
  createTask,
  getTask,
  updateTask,
  taskView,
  isOperationStale,
  ShoppingTaskError,
  type TaskRecord,
} from "./shopping-task-store";

const AUTO_DELAY_MS = 3000;

function release(task: TaskRecord) {
  task.operationToken = null;
  task.operationStartedAt = null;
}

export async function createShoppingTask(input: {
  userid: string;
  query: string;
  mode: ShoppingMode;
  idempotencyKey: string;
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
  return taskView(await createTask(input));
}

async function prepare(userid: string, taskId: string, token: string, task: TaskRecord) {
  try {
    await runShoppingReAct({
      userid,
      query: task.query,
      confirmOrder: false,
      control: {
        signal: AbortSignal.timeout(90_000),
        cartIdempotencyKey: `shopping:${taskId}:cart`,
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
        onProgress: async (data) => {
          await updateTask(userid, taskId, (current) => {
            if (current.operationToken === token) current.data = { ...current.data, ...data };
          });
        },
      },
    });
  } catch (error) {
    console.warn("shopping task preparation stopped", {
      taskId,
      type: error instanceof Error ? error.name : "unknown",
    });
  }
  const prepared = await updateTask(userid, taskId, (current) => {
    if (current.operationToken !== token) return;
    release(current);
    if (current.phase === "cancel_pending") return;
    if (current.data.quote && current.data.product) {
      current.phase = current.mode === "manual" ? "awaiting_confirmation" : "ready_to_order";
      current.commitAfter =
        current.mode === "auto" ? new Date(Date.now() + AUTO_DELAY_MS).toISOString() : null;
    } else {
      current.phase = "failed";
      current.data.error = "助手未能完成商品与报价准备，请重新发起购物需求。";
    }
  });
  if (prepared.phase === "cancel_pending" && !prepared.operationToken)
    await finishCancellation(userid, taskId);
}

async function finishCancellation(userid: string, taskId: string) {
  const token = randomUUID();
  let acquired = false;
  const task = await updateTask(userid, taskId, (current) => {
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
      quantity: 1,
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

async function commitOrder(userid: string, taskId: string, token: string, task: TaskRecord) {
  const quote = task.data.quote?.quote;
  if (!quote) throw new ShoppingTaskError("QUOTE_REQUIRED", "请先生成有效报价。");
  try {
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
        current.phase = "failed";
        current.data.errorCode = error.code;
        current.data.error =
          error.code === "AUTHORIZATION_REQUIRED"
            ? "请先完成 AI 下单授权。"
            : "订单未能创建，库存、购物车或报价可能已变化，请重新获取报价。";
      } else {
        // 包括提交成功但任务状态写回失败，不能视为未下单；同键核对恢复。
        current.phase = "reconciling_result";
        current.data.error = "订单结果暂不确定，请核对原任务，勿重复购买。";
      }
      release(current);
    });
  }
}

export type ShoppingTaskAction = "advance" | "cancel" | "confirm" | "retry-link" | "recover";

export async function actOnShoppingTask(
  userid: string,
  taskId: string,
  action: ShoppingTaskAction,
  confirmation?: { cartVersion: number; quoteId: string }
): Promise<ShoppingTask> {
  const token = randomUUID();
  let operation: "prepare" | "commit" | "cancel" | null = null;
  const task = await updateTask(userid, taskId, (current) => {
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
    if (action === "retry-link") {
      if (current.phase === "canceled" || current.phase === "link_creating") return;
      if (current.phase !== "canceled_link_failed")
        throw new ShoppingTaskError("TASK_NOT_RETRYABLE", "当前任务无需重试生成短链。");
      current.phase = "cancel_pending";
      operation = "cancel";
      return;
    }
    if (TERMINAL_PHASES.includes(current.phase)) return;
    if (current.operationToken) {
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
    if (current.phase === "cancel_pending") {
      operation = "cancel";
      return;
    }
    if (current.phase === "queued" && action === "advance") {
      operation = "prepare";
      current.phase = "searching";
    } else if (
      action === "confirm" &&
      current.phase === "awaiting_confirmation" &&
      current.mode === "manual"
    ) {
      const quote = current.data.quote?.quote;
      if (
        !quote ||
        confirmation?.quoteId !== quote.quoteId ||
        confirmation?.cartVersion !== quote.cartVersion
      )
        throw new ShoppingTaskError("QUOTE_MISMATCH", "确认信息与任务报价不一致，请刷新后重试。");
      operation = "commit";
    } else if (
      current.phase === "ready_to_order" &&
      current.mode === "auto" &&
      action === "advance"
    ) {
      if (!current.commitAfter || Date.now() < Date.parse(current.commitAfter)) return;
      operation = "commit";
    } else if (
      action === "recover" &&
      ["committing", "reconciling_result"].includes(current.phase)
    ) {
      operation = "commit";
    } else return;
    if (operation === "commit") current.phase = "committing";
    current.operationToken = token;
    current.operationStartedAt = new Date().toISOString();
  });
  if (operation === "prepare") await prepare(userid, taskId, token, task);
  else if (operation === "commit") await commitOrder(userid, taskId, token, task);
  else if (operation === "cancel") await finishCancellation(userid, taskId);
  return taskView(await getTask(userid, taskId));
}
