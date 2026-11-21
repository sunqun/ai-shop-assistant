import { request, type RequestResult } from "../auth/auth-retry";
import {
  AiCartItem,
  AiCartResponse,
  AiOrderResponse,
  AiQuoteResponse,
  CartItemInput,
  CartReconcileClientResult,
  CartQuote,
  UserCart,
} from "./type";

/** 获取购物车 */
export async function fetchCartRequest(): Promise<RequestResult<UserCart>> {
  return request<UserCart>("/api/v1/carts");
}

/** 合并购物车：按传入项与服务端库存对账，成功后通知购物车刷新 */
export async function reconcileCartRequest(items: CartItemInput[]): Promise<RequestResult<CartReconcileClientResult>> {
  const result = await request<CartReconcileClientResult>("/api/v1/carts/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, idempotencyKey: crypto.randomUUID() }),
  });
  if (result.success) {
    window.dispatchEvent(new CustomEvent("cart-updated"));
  }
  return result;
}

/** 获取购物车报价 */
export async function quoteCartRequest(cartVersion: number, selectedSkuIds?: string[]): Promise<RequestResult<{ quote: CartQuote }>> {
  return request<{ quote: CartQuote }>("/api/v1/carts/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cartVersion, selectedSkuIds }),
  });
}

/** 提交订单 */
export async function submitOrderRequest(
  cartVersion: number,
  quoteId: string,
  idempotencyKey: string
): Promise<RequestResult<{ orderGroupId: string }>> {
  return request<{ orderGroupId: string }>("/api/v1/carts/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cartVersion, quoteId, idempotencyKey }),
  });
}

/** AI 购物车对账 */
export async function reconcileAiCartRequest(items: AiCartItem[]): Promise<RequestResult<AiCartResponse>> {
  return request<AiCartResponse>("/api/v1/assistant/cart/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, idempotencyKey: crypto.randomUUID() }),
  });
}

/** AI 购物车报价 */
export async function quoteAiCartRequest(cartVersion: number): Promise<RequestResult<AiQuoteResponse>> {
  return request<AiQuoteResponse>("/api/v1/assistant/cart/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cartVersion }),
  });
}

/** AI 下单 */
export async function submitAiOrderRequest(cartVersion: number, quoteId: string): Promise<RequestResult<AiOrderResponse>> {
  return request<AiOrderResponse>("/api/v1/assistant/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cartVersion, quoteId, idempotencyKey: crypto.randomUUID() }),
  });
}
