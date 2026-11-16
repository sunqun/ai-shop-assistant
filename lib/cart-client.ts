export type LocalCartItem = { id: string; quantity: number; sku?: string };
import { readApiResponse, runWithLoginRetry } from "@/lib/auth-retry";
const CART_TOKEN_KEY = "ai-shop-cart-token";
export const CART_KEY = "ai-shop-cart";

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
  quote: { status: "needs_requote"; code: "QUOTE_REQUIRED" };
};

export function readLocalCart(): LocalCartItem[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is LocalCartItem =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as LocalCartItem).id === "string" &&
            Number.isSafeInteger((item as LocalCartItem).quantity) &&
            (item as LocalCartItem).quantity > 0
        )
      : [];
  } catch {
    return [];
  }
}

export function persistLocalCart(items: LocalCartItem[]) {
  window.localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("cart-updated"));
}

export function mergeLocalCartItem(
  items: LocalCartItem[],
  item: LocalCartItem,
  maxQuantity: number
): { items: LocalCartItem[]; reachedLimit: boolean } {
  const next = items.map((entry) => ({ ...entry }));
  const existing = next.find((entry) => entry.id === item.id);
  if (existing) {
    const requested = existing.quantity + item.quantity;
    existing.quantity = Math.min(requested, maxQuantity);
    if (item.sku) existing.sku = item.sku;
    return { items: next, reachedLimit: requested > maxQuantity };
  }
  next.push({ ...item, quantity: Math.min(item.quantity, maxQuantity) });
  return { items: next, reachedLimit: item.quantity > maxQuantity };
}

export async function addToCartAndPersist(item: LocalCartItem, maxQuantity: number) {
  const merged = mergeLocalCartItem(readLocalCart(), item, maxQuantity);
  await reconcileCart(merged.items);
  persistLocalCart(merged.items);
  return merged;
}

export function getCartToken(): string {
  const existing = window.localStorage.getItem(CART_TOKEN_KEY);
  if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  window.localStorage.setItem(CART_TOKEN_KEY, token);
  return token;
}

export async function reconcileCart(items: LocalCartItem[]): Promise<CartReconcileClientResult> {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/carts/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ cartToken: getCartToken(), items, idempotencyKey: crypto.randomUUID() }),
    });
    return readApiResponse<CartReconcileClientResult>(response, "库存校验失败");
  });
}

export async function quoteCart(cartVersion: number) {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/carts/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ cartToken: getCartToken(), cartVersion }),
    });
    return readApiResponse<Record<string, unknown>>(response, "报价失败");
  });
}

