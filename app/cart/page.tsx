"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PlaceholderCard } from "@/components/page-shell";
import { useAuth } from "@/components/auth";
import type { CartLine, CatalogProduct, CartQuote, UserCartItem } from "./type";
import {
  fetchCartRequest,
  getProductsRequest,
  quoteCartRequest,
  reconcileCartRequest,
  submitOrderRequest,
} from "./api";
import { CartRow } from "./cartRow";
import { CartTotal } from "./cartTotal";

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
    getProductsRequest()
      .then((result) => {
        if (!active || !result.success) return;
        const map = new Map<string, CatalogProduct>();
        for (const product of result.data.products) map.set(product.id, product);
        setCatalog(map);
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
    fetchCartRequest().then((result) => {
      if (!active) return;
      if (!result.success) {
        setInventoryState("error");
        return;
      }
      const cart = result.data;
      setItems(cart.items);
      setCartVersion(cart.items.length ? cart.cartVersion : null);
      setInventoryState("ready");
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
    quoteCartRequest(cartVersion).then((result) => {
      if (!active) return;
      if (!result.success) {
        setQuote(null);
        setQuoteState("error");
        return;
      }
      setQuote(result.data.quote);
      setQuoteState("ready");
    });
    return () => {
      active = false;
    };
  }, [cartVersion]);

  const rows = useMemo<CartLine[]>(
    () =>
      items
        .map((item) => ({ item, product: catalog.get(item.productId) }))
        .filter((row): row is CartLine => Boolean(row.product)),
    [items, catalog]
  );

  async function applyItems(nextItems: UserCartItem[]) {
    setItems(nextItems);
    setInventoryState("loading");
    const result = await reconcileCartRequest(
      nextItems.map((item) => ({
        id: item.skuId,
        quantity: item.requestedQuantity,
        sku: item.skuId,
      }))
    );
    if (!result.success) {
      setInventoryState("error");
      return;
    }
    const bySku = new Map(
      result.data.allocations.map((allocation) => [allocation.skuId, allocation])
    );
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
    setCartVersion(nextItems.length ? result.data.cartVersion : null);
    setInventoryState("ready");
  }

  function handleQuantityChange(skuId: string, quantity: number) {
    applyItems(
      items.map((entry) =>
        entry.skuId === skuId ? { ...entry, requestedQuantity: quantity } : entry
      )
    );
  }

  function handleRemove(skuId: string) {
    applyItems(items.filter((entry) => entry.skuId !== skuId));
  }

  async function createOrder() {
    if (!quote || cartVersion === null || submitting) return;
    setSubmitting(true);
    const result = await submitOrderRequest(cartVersion, quote.quoteId, idempotencyKey);
    setSubmitting(false);
    if (!result.success) {
      setIdempotencyKey((current) => current || crypto.randomUUID());
      return;
    }
    router.push("/orders");
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
         {rows.length} 件商品
        </div>
        <button className="button button--ghost" type="button" onClick={() => router.push("/")}>
          继续购物
        </button>
      </header>

      <div className="cart-layout">
        <section className="cart-sheet" aria-label="购物车商品">
          <div className="cart-sheet__list">
            {rows.map((line) => (
              <CartRow
                key={line.item.skuId}
                line={line}
                onQuantityChange={handleQuantityChange}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </section>

        <CartTotal
          quote={quote}
          quoteState={quoteState}
          inventoryState={inventoryState}
          isAuthorized={user.isAuthorized}
          submitting={submitting}
          itemCount={items.length}
          onPay={createOrder}
        />
      </div>
    </div>
  );
}
