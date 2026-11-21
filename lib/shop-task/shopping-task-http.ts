/**
 * 购物任务 HTTP 层通用包装器。
 *
 * 购物任务的各个 API 路由（创建、查询、推进/取消/确认/恢复）都需要相同的处理：
 *   1. 校验登录态，未登录统一返回 401；
 *   2. 执行具体业务逻辑（由调用方以回调传入，已解析出 userid）；
 *   3. 将 ShoppingTaskError 业务异常映射为对应 HTTP 状态码与中文提示；
 *   4. 其余未知异常统一兜底为 503。
 *
 * 使用方式：各 route 在自己的 handler 中调用 shoppingTaskResponse(async (userid) => {...})，
 * 只需专注入参校验与业务编排，无需重复处理登录与错误归一化。
 */
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/auth-server";
import { ShoppingTaskError } from "./shopping-task-store";
import type { ShoppingTask } from "./shopping-task-types";

/** 动作已执行，但服务端任务明确失败或结果待核对时，不能作为 HTTP 成功返回。 */
export function shoppingTaskResultResponse<T extends { task?: ShoppingTask | null }>(
  result: T,
  successStatus = 200
): Response {
  const task = result.task;
  if (task && ["failed", "canceled_link_failed", "reconciling_result"].includes(task.phase)) {
    const code = task.errorCode || (
      task.phase === "reconciling_result" ? "ORDER_RESULT_UNCERTAIN" :
      task.phase === "canceled_link_failed" ? "PAYMENT_LINK_CREATION_FAILED" :
      "SHOPPING_TASK_FAILED"
    );
    const conflicts = [
      "QUOTE_EXPIRED", "QUOTE_ALREADY_USED", "QUOTE_REQUIRED", "OUT_OF_STOCK",
      "CART_CHANGED", "CART_VERSION_CONFLICT", "CART_RESERVATION_EXPIRED",
    ];
    const status = code === "AUTHORIZATION_REQUIRED" ? 403 : conflicts.includes(code) ? 409 : 503;
    return NextResponse.json(
      { ...result, code, message: task.error || "购物流程未完成，请查看当前任务后重试。" },
      { status }
    );
  }
  return NextResponse.json(result, { status: successStatus });
}

// 包装购物任务请求的通用入口：接收一个已注入 userid 的业务回调，返回统一结构的 Response。
export async function shoppingTaskResponse(
  action: (userid: string) => Promise<Response>
): Promise<Response> {
  const session = await readSession();
  // 未登录时直接拒绝，避免后续业务访问到无主的 userid。
  if (!session)
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "请先登录后使用购物助手。" },
      { status: 401 }
    );
  try {
    // 业务逻辑由调用方提供；此处已确保 userid 来自已认证会话。
    return await action(session.userid);
  } catch (error) {
    // 业务错误：按其携带的状态码（默认 409）返回统一结构。
    if (error instanceof ShoppingTaskError)
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status }
      );
    // 未知异常：记录日志并返回 503，提示客户端稍后查询任务结果。
    console.error(
      "shopping task request failed",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        code: "SHOPPING_TASK_UNAVAILABLE",
        message: "购物任务暂时无法处理，请稍后重试查询当前任务。",
      },
      { status: 503 }
    );
  }
}
