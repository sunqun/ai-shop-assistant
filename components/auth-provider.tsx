"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { showToast } from "@/lib/toast";

export type AuthUser = { userid: string; username: string; isAuthorized: boolean };

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  loginOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
  login: (username: string, password: string, authorizationConsent: boolean) => Promise<void>;
  register: (username: string, password: string, confirmPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  authorize: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
type AuthRetryRequest = { resume: () => void; cancel: () => void };
const AUTH_REQUIRED_EVENT = "auth-required";

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const pendingAuthRetry = useRef<AuthRetryRequest | null>(null);

  useEffect(() => {
    const handleAuthRequired = (event: Event) => {
      const request = (event as CustomEvent<AuthRetryRequest>).detail;
      pendingAuthRetry.current?.cancel();
      pendingAuthRetry.current = request;
      setLoginOpen(true);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, []);

  const closeLogin = useCallback(() => {
    pendingAuthRetry.current?.cancel();
    pendingAuthRetry.current = null;
    setLoginOpen(false);
  }, []);

  const resumePendingAuthRetry = useCallback(() => {
    const request = pendingAuthRetry.current;
    pendingAuthRetry.current = null;
    request?.resume();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/auth/session", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, "会话服务暂不可用"));
        return response.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((body) => {
        if (!cancelled) setUser(body.user);
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          showToast("登录状态暂时无法读取，请稍后重试。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (username: string, password: string, authorizationConsent: boolean) => {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password, authorizationConsent }),
      });
      if (!response.ok) throw new Error(await readError(response, "登录失败"));
      const body = (await response.json()) as { user: AuthUser };
      setUser(body.user);
      setLoginOpen(false);
      resumePendingAuthRetry();
    },
    [resumePendingAuthRetry]
  );

  const register = useCallback(
    async (username: string, password: string, confirmPassword: string) => {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password, confirmPassword }),
      });
      if (!response.ok) throw new Error(await readError(response, "注册失败"));
      const body = (await response.json()) as { user: AuthUser };
      setUser(body.user);
      setLoginOpen(false);
      resumePendingAuthRetry();
    },
    [resumePendingAuthRetry]
  );

  const logout = useCallback(async () => {
    const response = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error("logout failed");
    setUser(null);
  }, []);

  const authorize = useCallback(async () => {
    const response = await fetch("/api/v1/me/authorization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ consent: true }),
    });
    if (!response.ok) throw new Error(await readError(response, "授权失败"));
    const body = (await response.json()) as { user: AuthUser };
    setUser(body.user);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        loginOpen,
        openLogin: () => setLoginOpen(true),
        closeLogin,
        login,
        register,
        logout,
        authorize,
      }}
    >
      {children}
      <LoginDialog />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

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
        onClick={() => void logout().catch(() => showToast("退出登录失败，请稍后重试。"))}
      >
        退出
      </button>
    </span>
  );
}

function LoginDialog() {
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
      if (mode === "register") await register(username, password, confirmPassword);
      else await login(username, password, consent);
    } catch {
      showToast(mode === "register" ? "注册失败，请稍后重试。" : "登录失败，请检查账号和密码后重试。");
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
            <p className="eyebrow">M1 身份与授权</p>
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
              setMode(mode === "login" ? "register" : "login");
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
