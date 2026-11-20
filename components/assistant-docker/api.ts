import { request, type RequestResult } from "@/lib/auth/auth-retry";
import type { DetailResponse, PaymentLinkView, SearchResponse } from "./types";

/** 搜索商品 */
export function searchProductsRequest(
  query: string,
  cursor?: string,
  sessionId?: string
): Promise<RequestResult<SearchResponse>> {
  return request<SearchResponse>("/api/v1/assistant/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, cursor, pageSize: 20, sessionId }),
  });
}

/** 获取商品详情 */
export function getProductDetailRequest(productId: string): Promise<RequestResult<DetailResponse>> {
  return request<DetailResponse>(`/api/v1/products/detail?productId=${encodeURIComponent(productId)}`);
}

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
