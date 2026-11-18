"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PlaceholderCard } from "@/components/page-shell";
import { useAuth } from "@/components/auth-provider";
import type { CatalogProduct } from "@/lib/catalog";
import { lineSubtotalMinor } from "@/lib/pricing-domain";
import {
  fetchCart,
  quoteCart,
  reconcileCart,
  submitOrder,
  type CartQuote,
  type UserCartItem,
} from "@/lib/cart-client";
import { showToast } from "@/lib/toast";

export default function CartPage() {
  const router = useRouter();
  const { user, loading: authLoading, openLogin } = useAuth();
  const [items, setItems] = useState<UserCartItem[]>([]);
  const [inventoryState, setInventoryState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [cartVersion, setCartVersion] = useState<number | null>(null);
  const [quoteState, setQuoteState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [catalog, setCatalog] = useState<Map<string, CatalogProduct>>(new Map());
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    fetch("/api/v1/products", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("products request failed");
        return response.json() as Promise<{ products?: CatalogProduct[] }>;
      })
      .then((data) => {
        if (!active) return;
        const map = new Map<string, CatalogProduct>();
        for (const product of data.products ?? []) map.set(product.id, product);
        setCatalog(map);
      })
      .catch(() => {
        if (active) showToast("商品目录暂时无法加载，请稍后重试。");
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setCartVersion(null);
      setQuote(null);
      setQuoteState("idle");
      setInventoryState("idle");
      return;
    }
    let active = true;
    setInventoryState("loading");
    fetchCart()
      .then((cart) => {
        if (!active) return;
        setItems(cart.items);
        setCartVersion(cart.items.length ? cart.cartVersion : null);
        setInventoryState("ready");
      })
      .catch(() => {
        if (!active) return;
        setInventoryState("error");
        showToast("购物车暂时无法加载，请稍后重试。");
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (cartVersion === null) {
      setQuote(null);
      setQuoteState("idle");
      return;
    }
    let active = true;
    setQuoteState("loading");
    quoteCart(cartVersion)
      .then((result) => {
        if (!active) return;
        setQuote(result.quote);
        setQuoteState("ready");
      })
      .catch(() => {
        if (!active) return;
        setQuote(null);
        setQuoteState("error");
        showToast("报价暂时无法获取，请稍后重试。");
      });
    return () => {
      active = false;
    };
  }, [cartVersion]);

  const rows = useMemo(
    () =>
      items
        .map((item) => ({ item, product: catalog.get(item.productId) }))
        .filter((row) => row.product),
    [items, catalog]
  );

  function formatMinor(value: number) {
    return `NT$${Math.round(value / 100).toLocaleString()}`;
  }

  async function applyItems(nextItems: UserCartItem[]) {
    setItems(nextItems);
    setInventoryState("loading");
    try {
      const result = await reconcileCart(
        nextItems.map((item) => ({
          id: item.skuId,
          quantity: item.requestedQuantity,
          sku: item.skuId,
        }))
      );
      const bySku = new Map(result.allocations.map((allocation) => [allocation.skuId, allocation]));
      setItems(
        nextItems.map((item) => {
          const allocation = bySku.get(item.skuId);
          return allocation
            ? {
                ...item,
                requestedQuantity: allocation.quantity,
                allocatedQuantity: allocation.allocatedQuantity,
                unavailableQuantity: allocation.unavailableQuantity,
              }
            : item;
        })
      );
      setCartVersion(nextItems.length ? result.cartVersion : null);
      setInventoryState("ready");
    } catch {
      setInventoryState("error");
      showToast("购物车更新失败，请稍后重试。");
    }
  }

  async function createOrder() {
    if (!quote || cartVersion === null || submitting) return;
    setSubmitting(true);
    try {
      await submitOrder(cartVersion, quote.quoteId, idempotencyKey);
      router.push("/account/orders");
    } catch {
      showToast("订单创建失败，请稍后重试。");
      setIdempotencyKey((current) => current || crypto.randomUUID());
    } finally {
      setSubmitting(false);
    }
  }

  if (catalogLoading || authLoading)
    return (
      <div className="empty-state">
        <p>正在加载购物车...</p>
      </div>
    );

  if (!user)
    return (
      <div className="empty-state">
        <h2>请先登录</h2>
        <p>购物车已关联到你的账号，登录后才能查看和管理购物车。</p>
        <button className="button button--primary" type="button" onClick={openLogin}>
          登录
        </button>
      </div>
    );

  if (!rows.length)
    return (
      <div className="stack">
        <PlaceholderCard
          title="购物车为空"
          description="加入商品后，这里将展示商品、规格、数量和小计。"
          actionHref="/"
          actionLabel="去逛商品"
        />
      </div>
    );

  return (
    <div className="cart-page">
      <header className="cart-heading">
        <div>
          <p className="muted">{rows.length} 件商品</p>
        </div>
        <button className="button button--ghost" type="button" onClick={() => router.push("/")}>
          继续购物
        </button>
      </header>

      <div className="cart-layout">
        <section className="cart-sheet" aria-label="购物车商品">
          <div className="cart-sheet__list">
            {rows.map(({ item, product }) => {
              const subtotal =
                item.allocatedQuantity > 0
                  ? formatMinor(lineSubtotalMinor(product!.price, item.allocatedQuantity))
                  : "库存确认后计算";
              return (
                <article className="cart-row" key={item.skuId}>
                  <div
                    className={`cart-row__visual cart-row__visual--${product!.tone || "all"}`}
                    aria-hidden="true"
                  >
                    {(product!.brand || product!.name).slice(0, 1)}
                  </div>
                  <div className="cart-row__content">
                    <div className="cart-row__title">{product!.name}</div>
                    <div className="cart-row__brand">
                      {product!.brand} · {product!.category}
                    </div>
                    <span className="cart-row__unit">单价 NT${product!.price.toLocaleString()}</span>
                    {item.unavailableQuantity > 0 ? (
                      <span className="stock stock--out">
                        缺货 {item.unavailableQuantity} 件，已锁定 {item.allocatedQuantity} 件
                      </span>
                    ) : item.allocatedQuantity > 0 ? (
                      <span className="stock stock--in">已锁定 {item.allocatedQuantity} 件</span>
                    ) : null}
                  </div>
                  <label className="cart-quantity">
                    <span className="sr-only">{product!.name} 数量</span>
                    <input
                      type="number"
                      min="1"
                      max={product!.stock || 1}
                      value={item.requestedQuantity}
                      onChange={(event) => {
                        const quantity = Math.max(
                          1,
                          Math.min(product!.stock || 1, Number(event.target.value) || 1)
                        );
                        applyItems(
                          items.map((entry) =>
                            entry.skuId === item.skuId ? { ...entry, requestedQuantity: quantity } : entry
                          )
                        );
                      }}
                    />
                  </label>
                  <strong className="cart-row__subtotal">{subtotal}</strong>
                  <button
                    className="cart-remove"
                    type="button"
                    onClick={() => applyItems(items.filter((entry) => entry.skuId !== item.skuId))}
                  >
                    移除
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="cart-total">
          <div className="cart-total__head">
            <span>预计应付</span>
            {quoteState === "ready" && quote ? (
              <strong className="cart-total__amount">{formatMinor(quote.totalDueMinor)}</strong>
            ) : (
              <span className="cart-total__amount cart-total__amount--pending">
                {inventoryState === "ready" ? "计算中" : "待确认"}
              </span>
            )}
          </div>

          {quoteState === "ready" && quote ? (
            <dl className="cart-total__lines">
              <div className="cart-total__line">
                <dt>商品小计</dt>
                <dd>{formatMinor(quote.subtotalMinor)}</dd>
              </div>
              <div className="cart-total__line">
                <dt>折扣减免</dt>
                <dd>
                  {quote.discountMinor ? `-${formatMinor(quote.discountMinor)}` : formatMinor(0)}
                </dd>
              </div>
              <div className="cart-total__line">
                <dt>运费</dt>
                <dd>{quote.shippingMinor ? formatMinor(quote.shippingMinor) : "免运费"}</dd>
              </div>
            </dl>
          ) : null}

          <div className="cart-total__foot">
            {user && !user.isAuthorized ? (
              <p className="cart-total__notice">尚未完成下单授权，请前往「订单」页完成授权。</p>
            ) : null}
            <button
              className="cart-total__pay"
              type="button"
              disabled={
                quoteState !== "ready" ||
                !user?.isAuthorized ||
                submitting ||
                items.length === 0
              }
              onClick={createOrder}
            >
              {submitting ? "正在创建订单…" : "付款"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
