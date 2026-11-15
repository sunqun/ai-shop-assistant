"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { getProduct } from "@/lib/products";

type CartItem = { id: string; quantity: number; sku?: string };
const CART_KEY = "ai-shop-cart";

function readCart(): CartItem[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter(
          (item): item is CartItem =>
            item && typeof item.id === "string" && Number.isFinite(item.quantity) && item.quantity > 0
        )
      : [];
  } catch {
    return [];
  }
}

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const refresh = () => setItems(readCart());
    refresh();
    window.addEventListener("cart-updated", refresh);
    return () => window.removeEventListener("cart-updated", refresh);
  }, []);

  const rows = useMemo(
    () => items.map((item) => ({ item, product: getProduct(item.id) })).filter((row) => row.product),
    [items]
  );
  const total = rows.reduce((sum, row) => sum + row.product!.price * row.item.quantity, 0);

  function persist(next: CartItem[]) {
    setItems(next);
    window.localStorage.setItem(CART_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("cart-updated"));
  }

  if (!rows.length)
    return (
      <PageShell eyebrow="M2 网站商城选品与加购" title="购物车">
        <PlaceholderCard
          title="购物车为空"
          description="加入商品后，这里将展示商品、规格、数量和小计。"
          actionHref="/"
          actionLabel="去逛商品"
        />
      </PageShell>
    );

  return (
    <PageShell eyebrow="M2 网站商城选品与加购" title="购物车" description="查看已选商品，调整数量或移除条目。">
      <div className="cart-layout">
        <section className="cart-list" aria-label="购物车商品">
          {rows.map(({ item, product }) => (
            <article className="cart-row" key={item.id}>
              <div className="cart-row__visual" style={{ background: product!.accent }} aria-hidden="true">
                {product!.name.slice(0, 1)}
              </div>
              <div className="cart-row__content">
                <Link href={`/products/${product!.id}`} className="cart-row__title">
                  {product!.name}
                </Link>
                <span className="muted">规格：{item.sku || product!.specs[0]}</span>
                <span className="price">NT${product!.price.toLocaleString()}</span>
              </div>
              <label className="cart-quantity">
                <span className="sr-only">{product!.name} 数量</span>
                <input
                  type="number"
                  min="1"
                  max={product!.stock || 1}
                  value={item.quantity}
                  onChange={(event) => {
                    const quantity = Math.max(1, Math.min(product!.stock || 1, Number(event.target.value) || 1));
                    persist(items.map((entry) => (entry.id === item.id ? { ...entry, quantity } : entry)));
                  }}
                />
              </label>
              <strong className="cart-row__subtotal">NT${(product!.price * item.quantity).toLocaleString()}</strong>
              <button className="button button--ghost cart-remove" type="button" onClick={() => persist(items.filter((entry) => entry.id !== item.id))}>
                移除
              </button>
            </article>
          ))}
        </section>
        <aside className="cart-summary card">
          <p className="eyebrow">费用摘要</p>
          <div className="cart-summary__line"><span>商品小计</span><strong>NT${total.toLocaleString()}</strong></div>
          <div className="cart-summary__line muted"><span>库存与报价</span><span>结账前确认</span></div>
          <div className="cart-summary__total"><span>预计商品金额</span><strong>NT${total.toLocaleString()}</strong></div>
          <Link className="button button--primary" href="/checkout">去结账</Link>
          <Link className="button button--ghost" href="/">继续购物</Link>
        </aside>
      </div>
    </PageShell>
  );
}
