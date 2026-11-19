import { request, type RequestResult } from "@/lib/auth/auth-retry";
import type { DetailResponse, SearchResponse } from "./types";

/** 搜索商品 */
export function searchProductsRequest(query: string, cursor?: string): Promise<RequestResult<SearchResponse>> {
  return request<SearchResponse>("/api/v1/assistant/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, cursor, pageSize: 20 }),
  });
}

/** 获取商品详情 */
export function getProductDetailRequest(productId: string): Promise<RequestResult<DetailResponse>> {
  return request<DetailResponse>(`/api/v1/products/detail?productId=${encodeURIComponent(productId)}`);
}
