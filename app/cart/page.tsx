"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { getProduct } from "@/lib/products";
import { quoteCart, reconcileCart } from "@/lib/cart-client";

type CartItem = { id: string; quantity: number; sku?: string };
type QuoteView = {
  quoteId: string;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  totalDueMinor: number;
  promotion: string;
  appliedRules?: string[];
  label: string;
  expiresAt: string;
};
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
  const [inventoryState, setInventoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [inventoryMessage, setInventoryMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Record<string, { allocatedQuantity: number; unavailableQuantity: number }>>({});
  const [cartVersion, setCartVersion] = useState<number | null>(null);
  const [quoteState, setQuoteState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [quoteMessage, setQuoteMessage] = useState("");
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [quoteRefreshKey, setQuoteRefreshKey] = useState(0);

  useEffect(() => {
    const refresh = () => setItems(readCart());
    refresh();
    window.addEventListener("cart-updated", refresh);
    return () => window.removeEventListener("cart-updated", refresh);
  }, []);

  useEffect(() => {
    if (!items.length) {
      setInventoryState("idle");
      setExpiresAt(null);
      setAllocations({});
      setCartVersion(null);
      setQuote(null);
      setQuoteState("idle");
      return;
    }
    let active = true;
    setInventoryState("loading");
    setInventoryMessage("");
    setExpiresAt(null);
    setAllocations({});
    setCartVersion(null);
    setQuote(null);
    setQuoteState("idle");
    reconcileCart(items)
      .then((result) => {
        if (!active) return;
        const nextAllocations: Record<string, { allocatedQuantity: number; unavailableQuantity: number }> = {};
        for (const allocation of (result.allocations as Array<{ skuId: string; allocatedQuantity: number; unavailableQuantity: number }> | undefined) ?? []) {
          nextAllocations[allocation.skuId] = allocation;
        }
        setAllocations(nextAllocations);
        setExpiresAt(typeof result.expiresAt === "string" ? result.expiresAt : null);
        setCartVersion(typeof result.cartVersion === "number" ? result.cartVersion : null);
        setInventoryMessage(result.split ? "库存已部分锁定，缺货数量会在结账前继续显示。" : "库存已锁定 24 小时，报价将在结账前重新确认。");
        setInventoryState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setInventoryState("error");
        setInventoryMessage(error instanceof Error ? error.message : "库存校验失败，请稍后重试。");
      });
    return () => {
      active = false;
    };
  }, [items]);

  useEffect(() => {
    if (cartVersion === null) return;
    let active = true;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    setQuoteState("loading");
    setQuoteMessage("");
    setQuote(null);
    quoteCart(cartVersion)
      .then((result) => {
        if (!active) return;
        const value = result.quote as Partial<QuoteView> | undefined;
        if (
          !value ||
          typeof value.quoteId !== "string" ||
          typeof value.subtotalMinor !== "number" ||
          typeof value.discountMinor !== "number" ||
          typeof value.shippingMinor !== "number" ||
          typeof value.totalDueMinor !== "number" ||
          typeof value.promotion !== "string" ||
          typeof value.label !== "string" ||
          typeof value.expiresAt !== "string"
        ) {
          throw new Error("报价响应无效");
        }
        setQuote(value as QuoteView);
        setQuoteState("ready");
        expiryTimer = setTimeout(() => {
          if (!active) return;
          setQuote(null);
          setQuoteState("error");
          setQuoteMessage("报价已过期，请重新报价后再继续。");
        }, Math.max(0, Date.parse(value.expiresAt) - Date.now()));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setQuote(null);
        setQuoteState("error");
        setQuoteMessage(error instanceof Error ? error.message : "报价失败，请稍后重试。");
      });
    return () => {
      active = false;
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [cartVersion, quoteRefreshKey]);

  const rows = useMemo(
    () => items.map((item) => ({ item, product: getProduct(item.id) })).filter((row) => row.product),
    [items]
  );
  function formatMinor(value: number) {
    return `NT$${Math.round(value / 100).toLocaleString()}`;
  }

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
      <div className="stack cart-inventory-status" role="status" aria-live="polite">
        {inventoryState === "loading" ? <p className="notice">正在校验库存并尝试锁定 24 小时...</p> : null}
        {inventoryState === "error" ? <p className="notice notice--error">{inventoryMessage}</p> : null}
        {inventoryState === "ready" ? (
          <p className="notice">
            {inventoryMessage} {expiresAt ? `锁定截止：${new Date(expiresAt).toLocaleString()}` : null}
          </p>
        ) : null}
        {quoteState === "loading" ? <p className="notice">正在重新计算优惠和运费...</p> : null}
        {quoteState === "error" ? <p className="notice notice--error">{quoteMessage}</p> : null}
      </div>
      <div className="cart-layout">
        <section className="cart-list" aria-label="购物车商品">
          {rows.map(({ item, product }) => (
            <article className="cart-row" key={item.id}>
              <div className="cart-row__visual" style={{ background: product!.accent }} aria-hidden="true">
                {product!.name.slice(0, 1)}
              </div>
              <div className="cart-row__content">
                <Link href={`/products/detail?productId=${encodeURIComponent(product!.id)}`} className="cart-row__title">
                  {product!.name}
                </Link>
                <span className="muted">规格：{item.sku || product!.specs[0]}</span>
                <span className="price">NT${product!.price.toLocaleString()}</span>
                {allocations[item.id]?.unavailableQuantity ? (
                  <span className="stock stock--out">缺货 {allocations[item.id].unavailableQuantity} 件，已锁定 {allocations[item.id].allocatedQuantity} 件</span>
                ) : allocations[item.id] ? (
                  <span className="stock stock--in">已锁定 {allocations[item.id].allocatedQuantity} 件</span>
                ) : null}
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
              <strong className="cart-row__subtotal">
                {allocations[item.id]
                  ? `NT$${(product!.price * allocations[item.id].allocatedQuantity).toLocaleString()}`
                  : "库存确认后计算"}
              </strong>
              <button className="button button--ghost cart-remove" type="button" onClick={() => persist(items.filter((entry) => entry.id !== item.id))}>
                移除
              </button>
            </article>
          ))}
        </section>
        <aside className="cart-summary card">
          <p className="eyebrow">费用摘要</p>
          {quoteState === "ready" && quote ? (
            <>
              <div className="cart-summary__line"><span>商品小计</span><strong>{formatMinor(quote.subtotalMinor)}</strong></div>
              <div className="cart-summary__line"><span>折扣减免</span><strong>{quote.discountMinor ? `-${formatMinor(quote.discountMinor)}` : formatMinor(0)}</strong></div>
              <div className="cart-summary__line"><span>运费</span><strong>{quote.shippingMinor ? formatMinor(quote.shippingMinor) : "免运费"}</strong></div>
              <div className="cart-summary__total"><span>预计应付</span><strong>{formatMinor(quote.totalDueMinor)}</strong></div>
              <div className="cart-summary__rules">
                <span className="muted">已自动应用</span>
                {(quote.appliedRules?.length ? quote.appliedRules : [quote.label]).map((rule) => <span className="tag tag--success" key={rule}>{rule}</span>)}
              </div>
              <p className="muted">报价有效至 {new Date(quote.expiresAt).toLocaleString()}，购物车变化后会自动失效。</p>
            </>
          ) : (
            <div className="cart-summary__line muted"><span>库存与报价</span><span>{inventoryState === "ready" ? "等待报价" : "结账前确认"}</span></div>
          )}
          {inventoryState === "ready" && quoteState === "error" ? (
            <button className="button button--secondary" type="button" onClick={() => setQuoteRefreshKey((value) => value + 1)}>重新报价</button>
          ) : null}
          <Link className={`button button--primary${quoteState === "ready" ? "" : " button--disabled"}`} href={quoteState === "ready" ? "/checkout" : "#"} aria-disabled={quoteState !== "ready"} onClick={(event) => { if (quoteState !== "ready") event.preventDefault(); }}>去结账</Link>
          <Link className="button button--ghost" href="/">继续购物</Link>
        </aside>
      </div>
    </PageShell>
  );
}
