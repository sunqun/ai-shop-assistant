import { request } from "@/lib/auth/auth-retry";
import type { ShoppingMode, ShoppingTask } from "@/lib/shop-task/shopping-task-types";

type TaskResponse = { task: ShoppingTask };
const base = "/api/v1/assistant/tasks";

export function createShoppingTaskRequest(
  query: string,
  mode: ShoppingMode,
  idempotencyKey: string
) {
  return request<TaskResponse>(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, mode, idempotencyKey }),
  });
}

export function getActiveShoppingTaskRequest() {
  return request<{ task: ShoppingTask | null }>(base);
}

export function getShoppingTaskRequest(taskId: string) {
  return request<TaskResponse>(`${base}/${encodeURIComponent(taskId)}`);
}

/** 动作均按 taskId 幂等；服务端保管并复用订单和短链的稳定标识。 */
export function shoppingTaskActionRequest(
  taskId: string,
  action: "advance" | "cancel" | "confirm" | "retry-link" | "recover",
  confirmation?: { cartVersion: number; quoteId: string }
) {
  return request<TaskResponse>(`${base}/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(confirmation ?? {}),
  });
}
