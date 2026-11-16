"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { useAuth } from "@/components/auth-provider";
import { readApiResponse } from "@/lib/auth-retry";
import type { UserOrderView } from "@/lib/order-service";

function money(value: number) { return `NT$${Math.round(value / 100).toLocaleString()}`; }

export default function OrdersPage() {
  const { user, loading: authLoading, openLogin } = useAuth();
  const [orders, setOrders] = useState<UserOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    let active = true;
    fetch("/api/v1/me/orders", { cache: "no-store" }).then((response) => readApiResponse<{ orders: UserOrderView[] }>(response, "订单列表读取失败")).then((result) => { if (active) setOrders(result.orders); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "订单列表暂时无法读取。"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, authLoading]);

  return <PageShell eyebrow="M7 我的订单" title="订单" description="查看本人创建的订单记录。">
    {authLoading || loading ? <p role="status" className="muted">正在读取订单…</p> : null}
    {!authLoading && !user ? <div className="empty-state"><h2>登录后查看订单</h2><button className="button button--primary" type="button" onClick={openLogin}>登录</button></div> : null}
    {error ? <div className="empty-state" role="alert"><h2>订单列表读取失败</h2><p>{error}</p><button className="button button--secondary" type="button" onClick={() => window.location.reload()}>重试</button></div> : null}
    {!authLoading && user && !loading && !error && orders.length === 0 ? <PlaceholderCard title="还没有订单记录" description="创建订单后，记录会显示在这里。" actionHref="/" actionLabel="去逛商品" /> : null}
    {orders.length ? <div className="stack" aria-label="订单列表">{orders.map((order) => <article className="card stack" key={order.orderGroupId}>
      <div className="section__heading"><div><p className="eyebrow">{order.source === "AI" ? "AI 下单" : "网站下单"}</p><h2>订单 {order.orderGroupId}</h2><p className="muted">创建时间：{new Date(order.createdAt).toLocaleString()}</p></div><strong>{money(order.totalMinor)}</strong></div>
      <div className="list">{order.items.map((item) => <div className="list-item" key={`${order.orderGroupId}-${item.skuId}`}><div><p className="list-item__title">{item.productName}</p><p className="list-item__meta">规格：{item.skuId} · 数量：{item.quantity}</p></div><span>{money(item.unitPriceMinor)} / 件</span></div>)}</div>
      <p className="notice">订单已创建，支付未接入</p><Link className="button button--soft" href={`/orders/${order.orderGroupId}`}>查看订单记录</Link>
    </article>)}</div> : null}
  </PageShell>;
}
