"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { readApiResponse } from "@/lib/auth-retry";
import type { UserOrderView } from "@/lib/order-service";

export default function OrderResultPage({ params }: { params: Promise<{ orderGroupId: string }> }) {
  const [order, setOrder] = useState<UserOrderView | null>(null);
  const [message, setMessage] = useState("正在读取订单记录…");
  useEffect(() => { params.then(({ orderGroupId }) => fetch(`/api/v1/me/orders/${orderGroupId}`, { cache: "no-store" }).then((response) => readApiResponse<{ order: UserOrderView }>(response, "订单读取失败")).then((result) => setOrder(result.order)).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "订单读取失败。"))); }, [params]);
  if (!order) return <PageShell eyebrow="M6 订单回执" title="订单回执"><PlaceholderCard title="暂时无法读取订单" description={message} actionHref="/account/orders" actionLabel="返回订单列表" /></PageShell>;
  return <PageShell eyebrow="M6 订单回执" title="订单已创建" description="支付未接入，本页仅展示已保存的订单记录。"><div className="card stack"><p className="notice">订单已创建，支付未接入</p><h2>订单 {order.orderGroupId}</h2><p className="muted">创建时间：{new Date(order.createdAt).toLocaleString()}</p><Link className="button button--soft" href={`/orders/${order.orderGroupId}`}>查看订单记录</Link><Link className="button button--ghost" href="/">继续购物</Link></div></PageShell>;
}
