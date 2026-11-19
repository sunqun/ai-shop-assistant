import { request, type RequestResult } from "../auth/auth-retry";

export type PaymentLinkView = {
  linkId: string;
  token: string;
  urlToken: string;
  username: string;
  product: { id: string; name: string; price: number; currency: string; stock: number };
  quantity: number;
  createdAt: string;
};

/** 获取支付短链列表 */
export async function listPaymentLinksRequest(): Promise<RequestResult<PaymentLinkView[]>> {
  const result = await request<{ links?: PaymentLinkView[] }>("/api/v1/assistant/payment-links");
  if (!result.success) return { success: false, errorMsg: result.errorMsg };
  return { success: true, data: Array.isArray(result.data.links) ? result.data.links : [] };
}

/** 创建支付短链 */
export async function createPaymentLinkRequest(productId: string, quantity: number): Promise<RequestResult<PaymentLinkView>> {
  const result = await request<{ link: PaymentLinkView }>("/api/v1/assistant/payment-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId, quantity }),
  });
  if (!result.success) return { success: false, errorMsg: result.errorMsg };
  return { success: true, data: result.data.link };
}

/** 删除支付短链 */
export async function deletePaymentLinkRequest(linkId: string): Promise<RequestResult<void>> {
  return request<void>(`/api/v1/assistant/payment-links/${encodeURIComponent(linkId)}`, {
    method: "DELETE",
  });
}
