import { request } from "@/lib/auth/auth-retry";
import type { ShoppingTask } from "@/lib/shop-task/shopping-task-types";
import type { AssistantMessageResult } from "@/lib/agent/dialogue-agent";
import type { CatalogReview } from "@/lib/catalog";

type TaskResponse = { task: ShoppingTask };
const base = "/api/v1/assistant/tasks";

export function sendAssistantMessageRequest(
  query: string,
  idempotencyKey: string,
  task?: ShoppingTask | null
) {
  return request<AssistantMessageResult>("/api/v1/assistant/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      idempotencyKey,
      taskId: task?.taskId,
      quote: task?.quote
        ? { quoteId: task.quote.quote.quoteId, cartVersion: task.quote.quote.cartVersion }
        : undefined,
    }),
  });
}

export function getActiveShoppingTaskRequest() {
  return request<{ task: ShoppingTask | null }>(base);
}

export function getReviewSourceRequest(productId: string, reviewId: string) {
  return request<{ review: CatalogReview }>(
    `/api/v1/products/reviews?productId=${encodeURIComponent(productId)}&reviewId=${encodeURIComponent(reviewId)}`
  );
}
export function getReviewPageRequest(productId: string, cursor?: string) {
  return request<{ reviews: CatalogReview[]; nextCursor: string | null }>(
    `/api/v1/products/reviews?productId=${encodeURIComponent(productId)}&pageSize=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
  );
}

export function getShoppingTaskRequest(taskId: string) {
  return request<TaskResponse>(`${base}/${encodeURIComponent(taskId)}`);
}

/** 动作均按 taskId 幂等；服务端保管并复用订单和短链的稳定标识。 */
export function shoppingTaskActionRequest(
  taskId: string,
  action: "advance" | "cancel" | "confirm" | "retry-link" | "recover" | "resume-after-reviews",
  confirmation?: { cartVersion: number; quoteId: string }
) {
  return request<TaskResponse>(`${base}/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(confirmation ?? {}),
  });
}
