import { readApiResponse, runWithLoginRetry } from "@/lib/auth-retry";

export type CartItemInput = { id: string; quantity: number; sku?: string };

export type UserCartItem = {
  skuId: string;
  productId: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  unavailableQuantity: number;
};

export type UserCart = {
  cartId: string;
  source: "WEB" | "AI";
  cartVersion: number;
  expiresAt: string | null;
  items: UserCartItem[];
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  return runWithLoginRetry(async () => {
    const response = await fetch(url, { cache: "no-store", ...init });
    return readApiResponse<T>(response, "购物车请求失败");
  });
}

export async function fetchCart(): Promise<UserCart> {
  const response = await fetch("/api/v1/carts", { cache: "no-store" });
  return readApiResponse<UserCart>(response, "购物车读取失败");
}

export async function reconcileCart(items: CartItemInput[]): Promise<CartReconcileClientResult> {
  const result = await requestJson<CartReconcileClientResult>("/api/v1/carts/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, idempotencyKey: crypto.randomUUID() }),
  });
  window.dispatchEvent(new CustomEvent("cart-updated"));
  return result;
}

export async function quoteCart(cartVersion: number): Promise<{ quote: CartQuote }> {
  return requestJson<{ quote: CartQuote }>("/api/v1/carts/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cartVersion }),
  });
}

export async function submitOrder(
  cartVersion: number,
  quoteId: string,
  idempotencyKey: string
): Promise<{ orderGroupId: string }> {
  return requestJson<{ orderGroupId: string }>("/api/v1/carts/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cartVersion, quoteId, idempotencyKey }),
  });
}

function mergeCartItem(
  items: CartItemInput[],
  item: CartItemInput,
  maxQuantity: number
): { items: CartItemInput[]; reachedLimit: boolean } {
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

export async function addToCart(
  item: CartItemInput,
  maxQuantity: number
): Promise<{ reachedLimit: boolean }> {
  return runWithLoginRetry(async () => {
    const cart = await fetchCart();
    const current = cart.items.map((entry) => ({
      id: entry.skuId,
      quantity: entry.requestedQuantity,
      sku: entry.skuId,
    }));
    const merged = mergeCartItem(current, item, maxQuantity);
    await reconcileCart(merged.items);
    return { reachedLimit: merged.reachedLimit };
  });
}
