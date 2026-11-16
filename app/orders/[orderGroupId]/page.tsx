"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { readApiResponse } from "@/lib/auth-retry";
import type { UserOrderView } from "@/lib/order-service";

function money(value: number) { return `NT$${Math.round(value / 100).toLocaleString()}`; }

export default function OrderDetailPage({ params }: { params: Promise<{ orderGroupId: string }> }) {
  const [order, setOrder] = useState<UserOrderView | null>(null);
  const [message, setMessage] = useState("正在读取订单记录…");
  useEffect(() => { params.then(({ orderGroupId }) => fetch(`/api/v1/me/orders/${orderGroupId}`, { cache: "no-store" }).then((response) => readApiResponse<{ order: UserOrderView }>(response, "订单读取失败")).then((result) => setOrder(result.order)).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "订单读取失败。"))); }, [params]);
  if (!order) return <PageShell eyebrow="M6 订单记录" title="订单记录"><PlaceholderCard title="暂时无法读取订单" description={message} actionHref="/account/orders" actionLabel="返回订单列表" /></PageShell>;
  return <PageShell eyebrow="M6 订单记录" title="订单记录" description={`订单编号：${order.orderGroupId}`}><div className="layout-two-column"><section className="card stack"><h2>商品摘要</h2>{order.items.map((item) => <div className="list-item" key={item.skuId}><div><p className="list-item__title">{item.productName}</p><p className="list-item__meta">SKU：{item.skuId} · 数量：{item.quantity}</p></div><strong>{money(item.unitPriceMinor * item.quantity)}</strong></div>)}</section><aside className="card stack"><h2>订单摘要</h2><div className="cart-summary__line"><span>商品小计</span><strong>{money(order.subtotalMinor)}</strong></div><div className="cart-summary__line"><span>优惠</span><strong>{money(order.discountMinor)}</strong></div><div className="cart-summary__line"><span>运费</span><strong>{money(order.shippingMinor)}</strong></div><div className="cart-summary__total"><span>订单金额</span><strong>{money(order.totalMinor)}</strong></div><p className="notice">订单已创建，支付未接入</p><Link className="button button--ghost" href="/account/orders">返回订单列表</Link></aside></div></PageShell>;
}
