import { request, type RequestResult } from "@/lib/auth/auth-retry";
import type { ProductsResponse } from "./type";

/** 获取商品目录，用于展示购物车商品名称、品牌与库存 */
export function getProductsRequest(): Promise<RequestResult<ProductsResponse>> {
  return request<ProductsResponse>("/api/v1/products");
}

export {
  fetchCartRequest,
  quoteCartRequest,
  reconcileCartRequest,
  submitOrderRequest,
} from "@/lib/cart-client/api";
