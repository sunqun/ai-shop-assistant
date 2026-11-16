"use client";

import { useEffect, useState } from "react";
import { PlaceholderCard } from "@/components/page-shell";
import { useAuth } from "@/components/auth-provider";
import { readApiResponse } from "@/lib/auth-retry";
import type { UserOrderView } from "@/lib/order-service";
import { showToast } from "@/lib/toast";

function money(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export default function OrdersPage() {
  const { user, loading: authLoading, openLogin } = useAuth();
  const [orders, setOrders] = useState<UserOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  function toggleOrder(orderGroupId: string) {
    setExpandedOrders((current) => ({ ...current, [orderGroupId]: !current[orderGroupId] }));
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let active = true;
    fetch("/api/v1/me/orders", { cache: "no-store" })
      .then((response) =>
        readApiResponse<{ orders: UserOrderView[] }>(response, "订单列表读取失败")
      )
      .then((result) => {
        if (active) setOrders(result.orders);
      })
      .catch(() => {
        if (active) showToast("订单列表暂时无法读取，请稍后重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, authLoading]);

  return (
    <div className="orders-page">
      {authLoading || loading ? (
        <p role="status" className="muted">
          正在读取订单…
        </p>
      ) : null}
      {!authLoading && !user ? (
        <div className="empty-state">
          <h2>登录后查看订单</h2>
          <button className="button button--primary" type="button" onClick={openLogin}>
            登录
          </button>
        </div>
      ) : null}
      {!authLoading && user && !loading && orders.length === 0 ? (
        <PlaceholderCard
          title="还没有订单记录"
          description="创建订单后，记录会显示在这里。"
          actionHref="/"
          actionLabel="去逛商品"
        />
      ) : null}
      {orders.length ? (
        <div className="stack" aria-label="订单列表">
          {orders.map((order) => (
            <article className="card stack" key={order.orderGroupId}>
              <div className="section__heading">
                <div>
                  <p className="eyebrow">{order.source === "AI" ? "AI 下单" : "网站下单"}</p>
                </div>
                
              </div>
              <div className="list">
                {order.items.map((item) => (
                  <div className="list-item" key={`${order.orderGroupId}-${item.skuId}`}>
                    <div>
                      <p className="list-item__title">{item.productName}</p>
                      <p className="list-item__meta">
                        规格：{item.skuId} · 数量：{item.quantity}
                      </p>
                    </div>
                    <span>￥{money(item.unitPriceMinor * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: "right" }}>
                总计：{money(order.totalMinor)}
              </div>
              <button
                type="button"
                className="order-toggle"
                onClick={() => toggleOrder(order.orderGroupId)}
                aria-expanded={!!expandedOrders[order.orderGroupId]}
              >
                <span>订单信息</span>
                <span className="order-toggle__value">
                  {order.orderGroupId}
                  <span className="order-toggle__chevron" aria-hidden="true">
                    {expandedOrders[order.orderGroupId] ? "▴" : "▾"}
                  </span>
                </span>
              </button>        
              {expandedOrders[order.orderGroupId] ? (
                <>
                  <div className="cart-summary__line">
                    <span>商品小计</span>
                    {money(order.subtotalMinor)}
                  </div>
                  <div className="cart-summary__line">
                    <span>优惠</span>
                    {money(order.discountMinor)}
                  </div>
                  <div className="cart-summary__line">
                    <span>运费</span>
                    {money(order.shippingMinor)}
                  </div>
                  <div className="cart-summary__line">
                    <span>创建时间</span>
                    {new Date(order.createdAt).toLocaleString()}
                  </div>
                </>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
