import { request, type RequestResult } from "@/lib/auth/auth-retry";
import type { PaymentLinkLookupResponse, PaymentLinkOrderResponse } from "./type";

/** 查询支付短链信息 */
export function getPaymentLinkRequest(token: string): Promise<RequestResult<PaymentLinkLookupResponse>> {
  return request<PaymentLinkLookupResponse>(`/api/v1/handoff?token=${encodeURIComponent(token)}`);
}

/** 使用支付短链提交订单 */
export function submitPaymentLinkOrderRequest(input: {
  token: string;
  paymentPassword: string;
  idempotencyKey: string;
}): Promise<RequestResult<PaymentLinkOrderResponse>> {
  return request<PaymentLinkOrderResponse>("/api/v1/handoff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
