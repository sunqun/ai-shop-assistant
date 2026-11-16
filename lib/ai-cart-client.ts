export type AiCartItem = { id: string; quantity: number };
import { readApiResponse, runWithLoginRetry } from "@/lib/auth-retry";
export type AiCartResponse = {
  cartId: string;
  source: "AI";
  cartVersion: number;
  expiresAt: string;
  split: boolean;
  fullyOutOfStock: boolean;
  allocations: Array<{ skuId: string; quantity: number; allocatedQuantity: number; unavailableQuantity: number }>;
};

const AI_CART_TOKEN_KEY = "ai-shop-ai-cart-token";

export function getAiCartToken(): string {
  const existing = window.localStorage.getItem(AI_CART_TOKEN_KEY);
  if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  window.localStorage.setItem(AI_CART_TOKEN_KEY, token);
  return token;
}

async function readPayload(response: Response) {
  return readApiResponse(response, "请求失败");
}

export async function reconcileAiCart(items: AiCartItem[]) {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/assistant/cart/reconcile", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ cartToken: getAiCartToken(), items, idempotencyKey: crypto.randomUUID() }) });
    return readPayload(response) as Promise<AiCartResponse>;
  });
}

export async function quoteAiCart(cartVersion: number) {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/assistant/cart/quote", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ cartToken: getAiCartToken(), cartVersion }) });
    return readPayload(response) as Promise<{ quote: { quoteId: string; cartId: string; cartVersion: number; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; totalDueMinor: number; label: string; expiresAt: string } }>;
  });
}

export async function submitAiOrder(cartVersion: number, quoteId: string) {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/assistant/order", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ cartToken: getAiCartToken(), cartVersion, quoteId, idempotencyKey: crypto.randomUUID() }) });
    return readPayload(response) as Promise<{ orderGroupId: string; orders: Array<{ orderId: string }> }>;
  });
}
