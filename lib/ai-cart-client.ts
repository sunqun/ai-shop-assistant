import { readApiResponse, runWithLoginRetry } from "@/lib/auth-retry";

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

async function readPayload<T>(response: Response, fallback: string) {
  return readApiResponse<T>(response, fallback);
}

export async function reconcileAiCart(items: AiCartItem[]) {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/assistant/cart/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ items, idempotencyKey: crypto.randomUUID() }),
    });
    return readPayload<AiCartResponse>(response, "请求失败");
  });
}

export async function quoteAiCart(cartVersion: number) {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/assistant/cart/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ cartVersion }),
    });
    return readPayload<AiQuoteResponse>(response, "请求失败");
  });
}

export async function submitAiOrder(cartVersion: number, quoteId: string) {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/assistant/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ cartVersion, quoteId, idempotencyKey: crypto.randomUUID() }),
    });
    return readPayload<{ orderGroupId: string; orders: Array<{ orderId: string }> }>(response, "请求失败");
  });
}
