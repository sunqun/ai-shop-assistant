"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { useAuth } from "@/components/auth-provider";
import { getProduct } from "@/lib/products";
import { getCartToken, readLocalCart, reconcileCart, quoteCart } from "@/lib/cart-client";
import { readApiResponse } from "@/lib/auth-retry";

type QuoteView = { quoteId: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; totalDueMinor: number; expiresAt: string };
type CheckoutState = "loading" | "ready" | "error";

function money(value: number) { return `NT$${Math.round(value / 100).toLocaleString()}`; }

export default function CheckoutPage() {
  const { user, loading: authLoading, openLogin } = useAuth();
  const [state, setState] = useState<CheckoutState>("loading");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState(() => typeof window === "undefined" ? [] : readLocalCart());
  const [cartVersion, setCartVersion] = useState<number | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const rows = useMemo(() => items.map((item) => ({ item, product: getProduct(item.id) })).filter((row) => row.product), [items]);

  useEffect(() => {
    setItems(readLocalCart());
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!items.length) { setState("error"); setMessage("购物车为空，请先选择商品。"); return; }
    let active = true;
    setState("loading"); setMessage(""); setQuote(null); setCartVersion(null);
    reconcileCart(items).then(async (result) => {
      const version = result.cartVersion;
      const quoteResult = await quoteCart(version);
      if (!active) return;
      const value = quoteResult.quote as Partial<QuoteView> | undefined;
      if (!value || typeof value.quoteId !== "string" || typeof value.subtotalMinor !== "number" || typeof value.discountMinor !== "number" || typeof value.shippingMinor !== "number" || typeof value.totalDueMinor !== "number" || typeof value.expiresAt !== "string") throw new Error("报价信息无效，请返回购物车重试。");
      setCartVersion(version); setQuote(value as QuoteView); setState("ready");
    }).catch((error: unknown) => {
      if (!active) return;
      setState("error"); setMessage(error instanceof Error ? error.message : "无法确认购物车，请稍后重试。");
    });
    return () => { active = false; };
  }, [items]);

  async function createOrder() {
    if (!quote || cartVersion === null || submitting) return;
    setSubmitting(true); setMessage("");
    try {
      const response = await fetch("/api/v1/carts/order", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ cartToken: getCartToken(), cartVersion, quoteId: quote.quoteId, idempotencyKey }) });
      const result = await readApiResponse<{ orderGroupId: string }>(response, "订单创建失败");
      window.location.assign(`/orders/${result.orderGroupId}/result`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "订单创建失败，请稍后重试。");
      setIdempotencyKey((current) => current || crypto.randomUUID());
    } finally { setSubmitting(false); }
  }

  if (!rows.length && state === "error") return <PageShell eyebrow="M6 订单记录创建" title="确认订单"><PlaceholderCard title="无法继续结账" description={message} actionHref="/cart" actionLabel="返回购物车" /></PageShell>;

  return (
    <PageShell eyebrow="M6 订单记录创建" title="确认订单" description="确认商品和报价后创建订单记录；此操作不会发起支付。">
      <div className="layout-two-column">
        <section className="card stack" aria-label="订单商品">
          <h2>商品清单</h2>
          {rows.map(({ item, product }) => <div className="list-item" key={item.id}><div><p className="list-item__title">{product!.name}</p><p className="list-item__meta">规格：{item.sku || product!.specs[0]} · 数量：{item.quantity}</p></div><strong>{money(Math.round(product!.price * 100) * item.quantity)}</strong></div>)}
          <p className="notice">订单创建后仅保存订单信息，支付未接入。</p>
        </section>
        <aside className="card stack" aria-label="报价与创建订单">
          <h2>费用摘要</h2>
          {state === "loading" ? <p role="status" className="muted">正在确认库存和报价…</p> : null}
          {state === "ready" && quote ? <>
            <div className="cart-summary__line"><span>商品小计</span><strong>{money(quote.subtotalMinor)}</strong></div>
            <div className="cart-summary__line"><span>优惠</span><strong>{money(quote.discountMinor)}</strong></div>
            <div className="cart-summary__line"><span>运费</span><strong>{money(quote.shippingMinor)}</strong></div>
            <div className="cart-summary__total"><span>订单金额</span><strong>{money(quote.totalDueMinor)}</strong></div>
            <p className="muted">报价有效至 {new Date(quote.expiresAt).toLocaleString()}</p>
          </> : null}
          {state === "error" ? <p role="alert" className="notice notice--error">{message}</p> : null}
          {!authLoading && !user ? <><p className="muted">请登录后创建订单。</p><button className="button button--secondary" type="button" onClick={openLogin}>登录</button></> : null}
          {user && !user.isAuthorized ? <p role="alert" className="notice notice--error">当前账户尚未完成下单授权。请前往“我的”管理授权。</p> : null}
          {message && state !== "error" ? <p role="alert" className="notice notice--error">{message}</p> : null}
          <button className="button button--primary" type="button" disabled={state !== "ready" || !user?.isAuthorized || submitting} onClick={createOrder}>{submitting ? "正在创建订单…" : "付款"}</button>
          <Link className="button button--ghost" href="/cart">返回购物车</Link>
        </aside>
      </div>
    </PageShell>
  );
}
