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
  const [catalogError, setCatalogError] = useState(false);
  const productIdsKey = [...new Set(items.map((item) => item.productId))].sort().join(",");
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [quoteContext, setQuoteContext] = useState("");
  const selectedSkuIds = items.filter((item) => item.allocatedQuantity > 0 && selectedSkus.includes(item.skuId)).map((item) => item.skuId).sort();
  const selectionKey = JSON.stringify(selectedSkuIds);
  const contextKey = `${user?.userid ?? ""}:${cartVersion}:${selectionKey}`;
  const currentQuote = quoteContext === contextKey && inventoryState === "ready" ? quote : null;
  const selectionDisabled = submitting || inventoryState !== "ready";

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError(false);
    getProductsRequest(productIdsKey ? productIdsKey.split(",") : [])
      .then((result) => {
        if (!active) return;
        if (!result.success) { setCatalogError(true); return; }
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
  }, [productIdsKey]);

  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setSelectedSkus([]);
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
      setSelectedSkus(cart.items.filter((item) => item.allocatedQuantity > 0).map((item) => item.skuId));
      setCartVersion(cart.items.length ? cart.cartVersion : null);
      setInventoryState("ready");
    });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (cartVersion === null || !selectedSkuIds.length || inventoryState !== "ready") {
      setQuote(null);
      setQuoteState("idle");
      return;
    }
    let active = true;
    setQuote(null);
    setQuoteState("loading");
    quoteCartRequest(cartVersion, JSON.parse(selectionKey) as string[]).then((result) => {
      if (!active) return;
      if (!result.success) {
        setQuote(null);
        setQuoteState("error");
        return;
      }
      setQuote(result.data.quote);
      setQuoteContext(contextKey);
      setIdempotencyKey(crypto.randomUUID());
      setQuoteState("ready");
    });
    return () => {
      active = false;
    };
  }, [cartVersion, selectionKey, contextKey, selectedSkuIds.length, inventoryState]);

  const rows = useMemo<CartLine[]>(
    () =>
      items
        .map((item) => ({ item, product: catalog.get(item.productId) }))
        .filter((row): row is CartLine => Boolean(row.product)),
    [items, catalog]
  );

  async function applyItems(nextItems: UserCartItem[]) {
    if (selectionDisabled) return;
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
    if (!currentQuote || quoteState !== "ready" || !selectedSkuIds.length || cartVersion === null || submitting) return;
    setSubmitting(true);
    const result = await submitOrderRequest(cartVersion, currentQuote.quoteId, idempotencyKey);
    setSubmitting(false);
    if (!result.success) {
      setIdempotencyKey((current) => current || crypto.randomUUID());
      return;
    }
    window.dispatchEvent(new CustomEvent("cart-updated"));
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

  if (catalogError || (items.length > 0 && rows.length !== items.length))
    return <div className="empty-state"><h2>部分购物车商品暂时无法读取</h2><p>请刷新后重试，购物车内容未被删除。</p></div>;

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
          <label className="cart-select-all">
            <input type="checkbox" aria-label="全选购物车商品" disabled={selectionDisabled}
              checked={selectedSkuIds.length > 0 && selectedSkuIds.length === items.filter((item) => item.allocatedQuantity > 0).length}
              ref={(input) => { if (input) input.indeterminate = selectedSkuIds.length > 0 && selectedSkuIds.length < items.filter((item) => item.allocatedQuantity > 0).length; }}
              onChange={(event) => setSelectedSkus(event.target.checked ? items.filter((item) => item.allocatedQuantity > 0).map((item) => item.skuId) : [])} />
            全选 · 已选 {selectedSkuIds.length} 件商品
          </label>
          <div className="cart-sheet__list">
            {rows.map((line) => (
              <CartRow
                key={line.item.skuId}
                line={line}
                checked={selectedSkuIds.includes(line.item.skuId)}
                disabled={selectionDisabled}
                onSelect={(skuId, checked) => setSelectedSkus((current) => checked ? [...new Set([...current, skuId])] : current.filter((sku) => sku !== skuId))}
                onQuantityChange={handleQuantityChange}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </section>

        <CartTotal
          quote={currentQuote}
          quoteState={currentQuote ? quoteState : quoteState === "error" ? "error" : selectedSkuIds.length ? "loading" : "idle"}
          inventoryState={inventoryState}
          isAuthorized={user.isAuthorized}
          submitting={submitting}
          itemCount={selectedSkuIds.length}
          onPay={createOrder}
        />
      </div>
    </div>
  );
}
