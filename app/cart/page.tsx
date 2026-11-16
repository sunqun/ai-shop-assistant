"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PlaceholderCard } from "@/components/page-shell";
import { useAuth } from "@/components/auth-provider";
import type { CatalogProduct } from "@/lib/catalog";
import { getCartToken, quoteCart, reconcileCart } from "@/lib/cart-client";
import { readApiResponse } from "@/lib/auth-retry";
import { showToast } from "@/lib/toast";

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
            item &&
            typeof item.id === "string" &&
            Number.isFinite(item.quantity) &&
            item.quantity > 0
        )
      : [];
  } catch {
    return [];
  }
}

export default function CartPage() {
  const router = useRouter();
  const { user, loading: authLoading, openLogin } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [inventoryState, setInventoryState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [allocations, setAllocations] = useState<
    Record<string, { allocatedQuantity: number; unavailableQuantity: number }>
  >({});
  const [cartVersion, setCartVersion] = useState<number | null>(null);
  const [quoteState, setQuoteState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [quoteRefreshKey, setQuoteRefreshKey] = useState(0);
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
    const refresh = () => setItems(readCart());
    refresh();
    window.addEventListener("cart-updated", refresh);
    return () => window.removeEventListener("cart-updated", refresh);
  }, []);

  useEffect(() => {
    if (!items.length) {
      setInventoryState("idle");
      setAllocations({});
      setCartVersion(null);
      setQuote(null);
      setQuoteState("idle");
      return;
    }
    let active = true;
    setInventoryState("loading");
    reconcileCart(items)
      .then((result) => {
        if (!active) return;
        const nextAllocations: Record<
          string,
          { allocatedQuantity: number; unavailableQuantity: number }
        > = {};
        for (const allocation of (result.allocations as
          | Array<{ skuId: string; allocatedQuantity: number; unavailableQuantity: number }>
          | undefined) ?? []) {
          nextAllocations[allocation.skuId] = allocation;
        }
        setAllocations(nextAllocations);
        setCartVersion(typeof result.cartVersion === "number" ? result.cartVersion : null);
        setInventoryState("ready");
      })
      .catch(() => {
        if (!active) return;
        setInventoryState("error");
        showToast("库存确认失败，请稍后重试。");
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
        expiryTimer = setTimeout(
          () => {
            if (!active) return;
            setQuote(null);
            setQuoteState("error");
          },
          Math.max(0, Date.parse(value.expiresAt) - Date.now())
        );
      })
      .catch(() => {
        if (!active) return;
        setQuote(null);
        setQuoteState("error");
        showToast("报价暂时无法获取，请稍后重试。");
      });
    return () => {
      active = false;
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [cartVersion, quoteRefreshKey]);

  const rows = useMemo(
    () =>
      items.map((item) => ({ item, product: catalog.get(item.id) })).filter((row) => row.product),
    [items, catalog]
  );
  function formatMinor(value: number) {
    return `NT$${Math.round(value / 100).toLocaleString()}`;
  }

  function persist(next: CartItem[]) {
    setItems(next);
    window.localStorage.setItem(CART_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("cart-updated"));
  }

  async function createOrder() {
    if (!quote || cartVersion === null || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/carts/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          cartToken: getCartToken(),
          cartVersion,
          quoteId: quote.quoteId,
          idempotencyKey,
        }),
      });
      await readApiResponse<{ orderGroupId: string }>(response, "订单创建失败");
      router.push("/account/orders");
    } catch {
      showToast("订单创建失败，请稍后重试。");
      setIdempotencyKey((current) => current || crypto.randomUUID());
    } finally {
      setSubmitting(false);
    }
  }

  if (catalogLoading)
    return (
      <div className="empty-state">
        <p>正在加载购物车...</p>
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
    <div>
      <div className="cart-layout">
        <section className="cart-list" aria-label="购物车商品">
          {rows.map(({ item, product }) => (
            <article className="cart-row" key={item.id}>
              <div className="cart-row__visual" aria-hidden="true">
                {product!.name.slice(0, 1)}
              </div>
              <div className="cart-row__content">
                <div className="cart-row__title">{product!.name}</div>
                <span className="price">NT${product!.price.toLocaleString()}</span>
                {allocations[item.id]?.unavailableQuantity ? (
                  <span className="stock stock--out">
                    缺货 {allocations[item.id].unavailableQuantity} 件，已锁定{" "}
                    {allocations[item.id].allocatedQuantity} 件
                  </span>
                ) : allocations[item.id] ? (
                  <span className="stock stock--in">
                    已锁定 {allocations[item.id].allocatedQuantity} 件
                  </span>
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
                    const quantity = Math.max(
                      1,
                      Math.min(product!.stock || 1, Number(event.target.value) || 1)
                    );
                    persist(
                      items.map((entry) => (entry.id === item.id ? { ...entry, quantity } : entry))
                    );
                  }}
                />
              </label>
              <strong>
                {allocations[item.id]
                  ? `NT$${(product!.price * allocations[item.id].allocatedQuantity).toLocaleString()}`
                  : "库存确认后计算"}
              </strong>
              <button
                className="button button--ghost cart-remove"
                type="button"
                onClick={() => persist(items.filter((entry) => entry.id !== item.id))}
              >
                移除
              </button>
            </article>
          ))}
        </section>
        <aside className="cart-summary card">
          <p className="eyebrow">费用摘要</p>
          {quoteState === "ready" && quote ? (
            <>
              <div className="cart-summary__line">
                <span>商品小计</span>
                <strong>{formatMinor(quote.subtotalMinor)}</strong>
              </div>
              <div className="cart-summary__line">
                <span>折扣减免</span>
                <strong>
                  {quote.discountMinor ? `-${formatMinor(quote.discountMinor)}` : formatMinor(0)}
                </strong>
              </div>
              <div className="cart-summary__line">
                <span>运费</span>
                <strong>{quote.shippingMinor ? formatMinor(quote.shippingMinor) : "免运费"}</strong>
              </div>
              <div className="cart-summary__total">
                <span>预计应付</span>
                <strong>{formatMinor(quote.totalDueMinor)}</strong>
              </div>
            </>
          ) : (
            <div className="cart-summary__line muted">
              <span>库存与报价</span>
              <span>{inventoryState === "ready" ? "等待报价" : "结账前确认"}</span>
            </div>
          )}
          {inventoryState === "ready" && quoteState === "error" ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setQuoteRefreshKey((value) => value + 1)}
            >
              重新报价
            </button>
          ) : null}
          {!authLoading && !user ? (
            <>
              <p className="muted">请登录后付款。</p>
              <button className="button button--secondary" type="button" onClick={openLogin}>
                登录
              </button>
            </>
          ) : null}
          {user && !user.isAuthorized ? (
            <p className="notice notice--error">当前账户尚未完成下单授权，请前往“我的”管理授权。</p>
          ) : null}
          <button
            className="button button--primary"
            type="button"
            disabled={quoteState !== "ready" || !user?.isAuthorized || submitting}
            onClick={createOrder}
          >
            {submitting ? "正在创建订单…" : "付款"}
          </button>
          <button className="button button--ghost" type="button" onClick={() => router.push("/")}>
            继续购物
          </button>
        </aside>
      </div>
    </div>
  );
}
