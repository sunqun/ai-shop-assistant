import { request, RequestResult } from "@/lib/auth/auth-retry";
import { CategoriesResponse, GetProductsParams, ProductsResponse, PromotionRule } from "./type";

/** 获取商品列表，可按类目 / 关键词过滤 */
export function getProductsRequest(params: GetProductsParams = {}): Promise<RequestResult<ProductsResponse>> {
  const search = new URLSearchParams();
  if (params.categoryId) search.set("categoryId", params.categoryId);
  if (params.keyword) search.set("keyword", params.keyword);
  if (params.sort) search.set("sort", params.sort);
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  if (params.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return request<ProductsResponse>(`/api/v1/products${qs ? `?${qs}` : ""}`);
}

/** 获取商品类目列表 */
export function getCategoriesRequest(): Promise<RequestResult<CategoriesResponse>> {
  return request<CategoriesResponse>("/api/v1/categories");
}

/** 获取优惠配置 */
export function getStoreConfigRequest(): Promise<RequestResult<{ promotionRules?: PromotionRule[] }>> {
  return request<{ promotionRules?: PromotionRule[] }>("/api/v1/store-config");
}
