export type PaymentLink = {
  linkId: string;
  token: string;
  username: string;
  product: { id: string; name: string; price: number; currency: string; stock: number };
  quantity: number;
  createdAt: string;
};

export type Quote = {
  quote: {
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    totalDueMinor: number;
  };
};

export type Order = { orderGroupId: string };

/** 查询支付短链信息返回结构 */
export type PaymentLinkLookupResponse = { link?: PaymentLink };

/** 支付短链下单返回结构 */
export type PaymentLinkOrderResponse = { quote?: Quote; order?: Order };
