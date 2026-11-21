import { request, type RequestResult } from "@/lib/auth/auth-retry";
import type { ProductsResponse } from "./type";

/** 按商品 ID 获取商品信息，用于展示购物车商品名称、品牌与库存 */
export async function getProductsRequest(ids: string[]): Promise<RequestResult<ProductsResponse>> {
  const unique = [...new Set(ids)];
  const products: ProductsResponse["products"] = [];
  for (let offset = 0; offset < unique.length; offset += 40) {
    const query = new URLSearchParams({ ids: unique.slice(offset, offset + 40).join(",") });
    const result = await request<ProductsResponse>(`/api/v1/products?${query}`);
    if (!result.success) return result;
    products.push(...result.data.products);
  }
  return { success: true, data: { products } };
}

export {
  fetchCartRequest,
  quoteCartRequest,
  reconcileCartRequest,
  submitOrderRequest,
} from "@/lib/cart-client/api";
