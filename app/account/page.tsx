"use client";

import Link from "next/link";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { useAuth } from "@/components/auth-provider";

export default function AccountPage() {
  const { user, loading, openLogin, authorize } = useAuth();
  const [saving, setSaving] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");

  async function saveAuthorization() {
    if (!consent) return;
    setSaving(true);
    setError("");
    try {
      await authorize();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "授权失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell eyebrow="M6 我的" title="我的" description="从这里查看订单、物流、退款和授权管理。">
      <div className="status-grid">
        <div className="status-card">
          <p className="status-card__label">待处理订单</p>
          <p className="status-card__value">--</p>
        </div>
        <div className="status-card">
          <p className="status-card__label">运输中包裹</p>
          <p className="status-card__value">--</p>
        </div>
        <div className="status-card">
          <p className="status-card__label">退款/售后</p>
          <p className="status-card__value">--</p>
        </div>
      </div>
      <section className="section auth-card">
        <div>
          <p className="eyebrow">M1 身份与授权</p>
          <h2>AI 自助下单授权</h2>
          <p className="muted">授权后，后续下单流程将依据账户授权状态继续判断。</p>
        </div>
        {loading ? (
          <p className="muted">正在读取登录状态…</p>
        ) : !user ? (
          <>
            <p className="muted">请先登录，再管理授权。</p>
            <button className="button button--primary" type="button" onClick={openLogin}>
              登录
            </button>
          </>
        ) : user.isAuthorized ? (
          <p className="auth-card__status tag tag--success">已授权</p>
        ) : (
          <>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{" "}
              <span>同意AI自助下单，收货后自动扣款</span>
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="button button--primary"
              type="button"
              disabled={!consent || saving}
              onClick={saveAuthorization}
            >
              {saving ? "保存中…" : "保存授权"}
            </button>
          </>
        )}
      </section>
      <div className="section route-map">
        {[
          ["订单", "/account/orders"],
          ["物流", "/account/logistics"],
          ["退款与售后", "/account/refunds"],
        ].map(([label, href]) => (
          <Link className="route-link" href={href} key={href}>
            {label} →
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
