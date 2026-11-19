"use client";

import { useAuth } from "./context";

export function LoginButton() {
  const { user, loading, openLogin, logout } = useAuth();
  if (loading) return <span className="muted">加载中…</span>;
  if (!user)
    return (
      <button className="logout-button" type="button" onClick={openLogin}>
        登录
      </button>
    );
  return (
    <span className="auth-header">
      <span className="auth-header__name">{user.username}</span>
      <button
        className="logout-button"
        type="button"
        onClick={() => void logout()}
      >
        退出
      </button>
    </span>
  );
}
