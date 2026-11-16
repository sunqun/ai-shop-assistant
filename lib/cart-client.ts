export type LocalCartItem = { id: string; quantity: number; sku?: string };
const CART_TOKEN_KEY = "ai-shop-cart-token";

export function getCartToken(): string {
  const existing = window.localStorage.getItem(CART_TOKEN_KEY);
  if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  window.localStorage.setItem(CART_TOKEN_KEY, token);
  return token;
}

export async function reconcileCart(items: LocalCartItem[]) {
  const response = await fetch("/api/v1/carts/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ cartToken: getCartToken(), items, idempotencyKey: crypto.randomUUID() }),
  });
  const payload = (await response.json()) as { message?: string; [key: string]: unknown };
  if (!response.ok) throw new Error(payload.message || "库存校验失败");
  return payload;
}

export async function quoteCart(cartVersion: number) {
  const response = await fetch("/api/v1/carts/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ cartToken: getCartToken(), cartVersion }),
  });
  const payload = (await response.json()) as { message?: string; [key: string]: unknown };
  if (!response.ok) throw new Error(payload.message || "报价失败");
  return payload;
}

