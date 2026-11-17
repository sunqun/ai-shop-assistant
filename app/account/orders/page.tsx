"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PlaceholderCard } from "@/components/page-shell";
import { useAuth } from "@/components/auth-provider";
import { readApiResponse } from "@/lib/auth-retry";
import type { UserOrderView } from "@/lib/order-service";
import { showToast } from "@/lib/toast";

function money(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export default function OrdersPage() {
  const router = useRouter();
  const { user, loading: authLoading, openLogin, authorize } = useAuth();
  const [orders, setOrders] = useState<UserOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [consent, setConsent] = useState(false);

  function toggleOrder(orderGroupId: string) {
    setExpandedOrders((current) => ({ ...current, [orderGroupId]: !current[orderGroupId] }));
  }

  async function saveAuthorization() {
    if (!consent) return;
    setSaving(true);
    try {
      await authorize();
    } catch {
      showToast("授权失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
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
      <header className="orders-heading">
        <p className="muted">{user ? `${orders.length} 笔订单` : "登录后查看订单"}</p>
        <button className="button button--ghost" type="button" onClick={() => router.push("/")}>
          去购物
        </button>
      </header>

      <section className="orders-auth">
        <div>
          <h2>AI 自助下单授权</h2>
          <p className="muted">授权后，AI 助手可代为创建订单记录。</p>
        </div>
        {authLoading ? (
          <p className="muted">正在读取授权状态…</p>
        ) : !user ? (
          <p className="muted">登录后可管理授权。</p>
        ) : user.isAuthorized ? (
          <span className="orders-auth__status tag tag--success">已授权</span>
        ) : (
          <div className="orders-auth__actions">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{" "}
              <span>同意 AI 助手代为创建订单记录</span>
            </label>
            <button
              className="button button--primary"
              type="button"
              disabled={!consent || saving}
              onClick={saveAuthorization}
            >
              {saving ? "保存中…" : "保存授权"}
            </button>
          </div>
        )}
      </section>

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
        <section className="orders-grid" aria-label="订单列表">
          {orders.map((order) => {
            const expanded = !!expandedOrders[order.orderGroupId];
            return (
              <article className="order" key={order.orderGroupId}>
                <header className="order__head">
                  <div className="order__source">
                    <span
                      className={`order__badge${order.source === "AI" ? " order__badge--ai" : ""}`}
                    >
                      {order.source === "AI" ? "AI 下单" : "网站下单"}
                    </span>
                    <span className="order__id">{order.orderGroupId}</span>
                  </div>
                  <time className="order__time">{new Date(order.createdAt).toLocaleString()}</time>
                </header>
                <div className="order__items">
                  {order.items.map((item) => (
                    <div className="order__item" key={`${order.orderGroupId}-${item.skuId}`}>
                      <div className="order__item-main">
                        <span className="order__item-name">{item.productName}</span>
                        <span className="order__item-meta">
                          规格：{item.skuId} · 数量：{item.quantity}
                        </span>
                      </div>
                      <span className="order__item-amount">
                        {money(item.unitPriceMinor * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
                <footer className="order__foot">
                  <button
                    type="button"
                    className="order-toggle"
                    onClick={() => toggleOrder(order.orderGroupId)}
                    aria-expanded={expanded}
                  >
                    <span>订单明细</span>
                    <span className="order-toggle__chevron" aria-hidden="true">
                      {expanded ? "▴" : "▾"}
                    </span>
                  </button>
                  <strong className="order__total">总计 {money(order.totalMinor)}</strong>
                </footer>
                {expanded ? (
                  <dl className="order__detail">
                    <div className="order__detail-line">
                      <dt>商品小计</dt>
                      <dd>{money(order.subtotalMinor)}</dd>
                    </div>
                    <div className="order__detail-line">
                      <dt>优惠</dt>
                      <dd>{money(order.discountMinor)}</dd>
                    </div>
                    <div className="order__detail-line">
                      <dt>运费</dt>
                      <dd>{money(order.shippingMinor)}</dd>
                    </div>
                    <div className="order__detail-line">
                      <dt>创建时间</dt>
                      <dd>{new Date(order.createdAt).toLocaleString()}</dd>
                    </div>
                  </dl>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
