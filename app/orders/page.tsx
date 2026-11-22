"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PlaceholderCard } from "@/components/page-shell";
import { useAuth } from "@/components/auth";
import type { UserOrderView } from "./type";
import { getOrdersRequest } from "./api";
import { AuthorizationPanel } from "./authorizationPanel";
import { OrderCard } from "./orderCard";

export default function OrdersPage() {
  const router = useRouter();
  const { user, loading: authLoading, openLogin, authorize } = useAuth();
  const userId = user?.userid ?? null;
  const [orders, setOrders] = useState<UserOrderView[]>([]);
  const [ordersUserId, setOrdersUserId] = useState<string | null>(null);
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
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      setOrders([]);
      setOrdersUserId(null);
      setExpandedOrders({});
      setLoading(false);
      return;
    }
    let active = true;
    setOrders([]);
    setOrdersUserId(null);
    setExpandedOrders({});
    setLoading(true);
    getOrdersRequest()
      .then((result) => {
        if (!active) return;
        if (result.success) {
          setOrders(result.data.orders);
          setOrdersUserId(userId);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, authLoading]);

  const visibleOrders = userId === ordersUserId ? orders : [];

  return (
    <div className="orders-page">
      <header className="orders-heading">
        <p className="muted">{user ? `${visibleOrders.length} 笔订单` : "登录后查看订单"}</p>
        <button className="button button--ghost" type="button" onClick={() => router.push("/")}>
          去购物
        </button>
      </header>

      <AuthorizationPanel
        authLoading={authLoading}
        user={user}
        consent={consent}
        saving={saving}
        onConsentChange={setConsent}
        onSave={saveAuthorization}
      />

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
      {!authLoading && user && !loading && visibleOrders.length === 0 ? (
        <PlaceholderCard
          title="还没有订单记录"
          description="创建订单后，记录会显示在这里。"
          actionHref="/"
          actionLabel="去逛商品"
        />
      ) : null}
      {visibleOrders.length ? (
        <section className="orders-grid" aria-label="订单列表">
          {visibleOrders.map((order) => (
            <OrderCard
              key={order.orderGroupId}
              order={order}
              expanded={!!expandedOrders[order.orderGroupId]}
              onToggle={() => toggleOrder(order.orderGroupId)}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
