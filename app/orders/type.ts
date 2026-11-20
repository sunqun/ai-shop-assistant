import type { UserOrderView } from "@/lib/repository/order-service";

export type { UserOrderView };

/** 订单列表接口返回结构 */
export type OrdersResponse = {
  orders: UserOrderView[];
};
