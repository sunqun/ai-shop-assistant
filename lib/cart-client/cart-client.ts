import type { RequestResult } from "@/lib/auth/auth-retry";
import type { CartItemInput } from "./type";
import { fetchCartRequest, reconcileCartRequest } from "./api";
export type { CartQuote, UserCartItem } from "./type";

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
): Promise<RequestResult<{ reachedLimit: boolean }>> {
  // 从购物车中获取当前商品
  // 如果商品不存在，创建一个新商品
  // 如果商品存在，增加商品数量
  // 如果商品数量超过最大数量，设置商品数量为最大数量
  const cartResult = await fetchCartRequest();
  if (!cartResult.success) {
    return { success: false, errorMsg: cartResult.errorMsg };
  }
  const cart = cartResult.data;
  const current = cart.items.map((entry) => ({
    id: entry.skuId,
    quantity: entry.requestedQuantity,
    sku: entry.skuId,
  }));
  const merged = mergeCartItem(current, item, maxQuantity);
  // 合并商品后，更新购物车
  const result = await reconcileCartRequest(merged.items);
  if (!result.success) {
    return { success: false, errorMsg: result.errorMsg };
  }
  return { success: true, data: { reachedLimit: merged.reachedLimit } };
}

/** 商品添加到购物车动画 */
export function animateProductToCart(source: HTMLElement, target: HTMLElement) {
  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  const width = Math.min(118, Math.max(76, sourceRect.width * 0.32));
  const height = Math.min(76, Math.max(52, sourceRect.height * 0.42));
  ghost.className = `${source.className} cart-flight`;
  ghost.removeAttribute("data-product-visual");
  ghost.style.setProperty(
    "--flight-start-x",
    `${sourceRect.left + sourceRect.width / 2 - width / 2}px`
  );
  ghost.style.setProperty(
    "--flight-start-y",
    `${sourceRect.top + sourceRect.height / 2 - height / 2}px`
  );
  ghost.style.setProperty(
    "--flight-x",
    `${targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2)}px`
  );
  ghost.style.setProperty(
    "--flight-y",
    `${targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2)}px`
  );
  ghost.style.setProperty("--flight-width", `${width}px`);
  ghost.style.setProperty("--flight-height", `${height}px`);
  document.body.appendChild(ghost);
  window.requestAnimationFrame(() => ghost.classList.add("cart-flight--active"));
  window.setTimeout(() => ghost.remove(), 680);
}