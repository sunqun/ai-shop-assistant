
export type CartItemInput = { id: string; quantity: number; sku?: string };

export type UserCartItem = {
  skuId: string;
  productId: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  unavailableQuantity: number;
};


export type CartReconcileClientResult = {
  cartId: string;
  source: "WEB" | "AI";
  cartVersion: number;
  expiresAt: string;
  split: boolean;
  fullyOutOfStock: boolean;
  allocations: Array<{
    skuId: string;
    quantity: number;
    allocatedQuantity: number;
    unavailableQuantity: number;
  }>;
};

export type CartQuote = {
  quoteId: string;
  cartId: string;
  cartVersion: number;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  totalDueMinor: number;
  promotion: string;
  label: string;
  expiresAt: string;
};

export type UserCart = {
  cartId: string;
  source: "WEB" | "AI";
  cartVersion: number;
  expiresAt: string | null;
  items: UserCartItem[];
};

export type AiCartItem = { id: string; quantity: number };

export type AiCartResponse = {
  cartId: string;
  source: "AI";
  cartVersion: number;
  expiresAt: string;
  split: boolean;
  fullyOutOfStock: boolean;
  allocations: Array<{ skuId: string; quantity: number; allocatedQuantity: number; unavailableQuantity: number }>;
};

export type AiQuoteResponse = {
  quote: {
    quoteId: string;
    cartId: string;
    cartVersion: number;
    currency: string;
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    totalDueMinor: number;
    label: string;
    expiresAt: string;
  };
};

export type AiOrderResponse = {
  orderGroupId: string;
  orders: Array<{ orderId: string }>;
};
