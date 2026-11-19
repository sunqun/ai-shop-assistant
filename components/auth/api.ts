import { request, type RequestResult } from "@/lib/auth/auth-retry";
import type { AuthUser } from "./types";

export function fetchSessionRequest(): Promise<RequestResult<{ user: AuthUser | null }>> {
  return request<{ user: AuthUser | null }>("/api/v1/auth/session", { credentials: "same-origin" });
}

export function loginRequest(
  username: string,
  password: string,
  authorizationConsent: boolean
): Promise<RequestResult<{ user: AuthUser }>> {
  return request<{ user: AuthUser }>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username, password, authorizationConsent }),
  });
}

export function registerRequest(
  username: string,
  password: string,
  confirmPassword: string
): Promise<RequestResult<{ user: AuthUser }>> {
  return request<{ user: AuthUser }>("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username, password, confirmPassword }),
  });
}

export function logoutRequest(): Promise<RequestResult<void>> {
  return request<void>("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
}

export function authorizeRequest(): Promise<RequestResult<{ user: AuthUser }>> {
  return request<{ user: AuthUser }>("/api/v1/me/authorization", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ consent: true }),
  });
}
