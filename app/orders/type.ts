import type { UserOrderView } from "@/lib/order-service";

export type { UserOrderView };

/** 订单列表接口返回结构 */
export type OrdersResponse = {
  orders: UserOrderView[];
};
