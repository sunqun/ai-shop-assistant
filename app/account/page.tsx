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
    <PageShell eyebrow="M7 我的" title="我的" description="从这里查看本人创建的订单记录和下单授权。">
      <section className="section auth-card">
        <div>
          <p className="eyebrow">M1 身份与授权</p>
          <h2>AI 自助下单授权</h2>
          <p className="muted">授权后，AI 助手可以代为创建订单记录；本期不接入支付或扣款。</p>
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
              <span>同意 AI 助手代为创建订单记录</span>
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
        {[["订单记录", "/account/orders"]].map(([label, href]) => (
          <Link className="route-link" href={href} key={href}>
            {label} →
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
