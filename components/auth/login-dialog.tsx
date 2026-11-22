"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./context";

export function LoginDialog() {
  const { loginOpen, closeLogin, login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [consent, setConsent] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loginOpen) {
      setMode("login");
      setUsername("");
      setPassword("");
      setConfirmPassword("");
      setConsent(true);
      setSubmitting(false);
    }
  }, [loginOpen]);

  if (!loginOpen) return null;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "register") await register(username, password, confirmPassword, consent);
      else await login(username, password, consent);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeLogin();
      }}
    >
      <section
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
      >
        <div className="auth-dialog__header">
          <div>
            <h2 id="login-dialog-title">
              {mode === "login" ? "登录 AI 商城" : "注册 AI 商城账号"}
            </h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={closeLogin}>
            ×
          </button>
        </div>
        <form className="auth-dialog__form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="login-username">用户名</label>
            <input
              id="login-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">密码</label>
            <input
              id="login-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </div>
          {mode === "register" ? (
            <>
              <div className="field">
                <label htmlFor="register-confirm-password">确认密码</label>
                <input
                  id="register-confirm-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />{" "}
                <span>同意 AI 助手代为创建订单记录</span>
              </label>
            </>
          ) : (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{" "}
              <span>同意 AI 助手代为创建订单记录</span>
            </label>
          )}
          <button className="button button--primary" type="submit" disabled={submitting}>
            {submitting
              ? mode === "login"
                ? "登录中…"
                : "注册中…"
              : mode === "login"
                ? "登录"
                : "注册"}
          </button>
          <button
            className="auth-mode-switch"
            type="button"
            onClick={() => {
              const nextMode = mode === "login" ? "register" : "login";
              setMode(nextMode);
              setConsent(true);
              setConfirmPassword("");
            }}
          >
            {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
          </button>
        </form>
      </section>
    </div>
  );
}
