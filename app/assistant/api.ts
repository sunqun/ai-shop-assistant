import { request, type RequestResult } from "@/lib/auth/auth-retry";
import type { AssistantResult, Confirmation, PaymentLinkResponse } from "./types";

/** 运行购物助手，生成商品推荐与待确认报价。 */
export function sendAssistantRequest(query: string): Promise<RequestResult<AssistantResult>> {
  return request<AssistantResult>("/api/v1/assistant/react", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

/** 确认下单；重试时由调用方复用同一个幂等键。 */
export function confirmAssistantOrderRequest(
  confirmation: Confirmation & { idempotencyKey: string }
): Promise<RequestResult<AssistantResult>> {
  return request<AssistantResult>("/api/v1/assistant/react/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(confirmation),
  });
}

/** 将当前选中的一件商品转为支付短链。 */
export function createAssistantPaymentLinkRequest(
  productId: string
): Promise<RequestResult<PaymentLinkResponse>> {
  return request<PaymentLinkResponse>("/api/v1/assistant/payment-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, quantity: 1 }),
  });
}
