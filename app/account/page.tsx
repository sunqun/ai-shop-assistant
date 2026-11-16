"use client";

import Link from "next/link";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { useAuth } from "@/components/auth-provider";
import { showToast } from "@/lib/toast";

export default function AccountPage() {
  const { user, loading, openLogin, authorize } = useAuth();
  const [saving, setSaving] = useState(false);
  const [consent, setConsent] = useState(false);

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

  return (
    <div className="account-page">
      <section className="section auth-card">
        <div>
          <h2>AI 自助下单授权</h2>
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
    </div>
  );
}
