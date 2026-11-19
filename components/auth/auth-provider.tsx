"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RequestResult } from "@/lib/auth/auth-retry";
import { AuthContext } from "./context";
import { LoginDialog } from "./login-dialog";
import type { AuthUser } from "./types";
import {
  authorizeRequest,
  fetchSessionRequest,
  loginRequest,
  logoutRequest,
  registerRequest,
} from "./api";

type AuthRetryRequest = { resume: () => void; cancel: () => void };
const AUTH_REQUIRED_EVENT = "auth-required";

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
    fetchSessionRequest()
      .then((result) => {
        if (cancelled) return;
        if (result.success) setUser(result.data.user);
        else setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (
      username: string,
      password: string,
      authorizationConsent: boolean
    ): Promise<RequestResult<AuthUser>> => {
      const result = await loginRequest(username, password, authorizationConsent);
      if (!result.success) return { success: false, errorMsg: result.errorMsg };
      setUser(result.data.user);
      setLoginOpen(false);
      resumePendingAuthRetry();
      return { success: true, data: result.data.user };
    },
    [resumePendingAuthRetry]
  );

  const register = useCallback(
    async (
      username: string,
      password: string,
      confirmPassword: string
    ): Promise<RequestResult<AuthUser>> => {
      const result = await registerRequest(username, password, confirmPassword);
      if (!result.success) return { success: false, errorMsg: result.errorMsg };
      setUser(result.data.user);
      setLoginOpen(false);
      resumePendingAuthRetry();
      return { success: true, data: result.data.user };
    },
    [resumePendingAuthRetry]
  );

  const logout = useCallback(async (): Promise<RequestResult<void>> => {
    const result = await logoutRequest();
    if (result.success) setUser(null);
    return result;
  }, []);

  const authorize = useCallback(async (): Promise<RequestResult<AuthUser>> => {
    const result = await authorizeRequest();
    if (!result.success) return { success: false, errorMsg: result.errorMsg };
    setUser(result.data.user);
    return { success: true, data: result.data.user };
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
