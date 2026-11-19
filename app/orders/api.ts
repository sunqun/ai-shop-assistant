import { request, type RequestResult } from "@/lib/auth/auth-retry";
import type { OrdersResponse } from "./type";

/** 获取当前用户订单列表 */
export function getOrdersRequest(): Promise<RequestResult<OrdersResponse>> {
  return request<OrdersResponse>("/api/v1/me/orders");
}
