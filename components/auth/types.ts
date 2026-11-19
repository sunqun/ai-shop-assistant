import type { RequestResult } from "@/lib/auth/auth-retry";

export type AuthUser = { userid: string; username: string; isAuthorized: boolean };

export type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  loginOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
  login: (username: string, password: string, authorizationConsent: boolean) => Promise<RequestResult<AuthUser>>;
  register: (username: string, password: string, confirmPassword: string) => Promise<RequestResult<AuthUser>>;
  logout: () => Promise<RequestResult<void>>;
  authorize: () => Promise<RequestResult<AuthUser>>;
};
