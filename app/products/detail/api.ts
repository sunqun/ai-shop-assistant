import { request, type RequestResult } from "@/lib/auth/auth-retry";
import type { DetailResponse } from "./type";

/** 获取商品详情与公开评论 */
export function getProductDetailRequest(productId: string): Promise<RequestResult<DetailResponse>> {
  return request<DetailResponse>(
    `/api/v1/products/detail?productId=${encodeURIComponent(productId)}`
  );
}
