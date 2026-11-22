import { showToast } from "@/lib/toast";

/**
 * 接口请求错误，携带 HTTP 状态码与后端错误码。
 * 便于调用方通过 `instanceof ApiRequestError` 区分业务/网络错误，并按 status/code 做处理。
 */
export class ApiRequestError extends Error {
  /** 后端返回的错误码（如 UNAUTHENTICATED），可能为空 */
  readonly code?: string;
  /** HTTP 状态码 */
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

type PendingAuthRequest = { resume: () => void; cancel: () => void };

/**
 * 执行请求，并在遇到 401 时触发登录流程，登录成功后自动重试一次。
 * 通过派发 `auth-required` 事件通知 AuthProvider 打开登录弹窗，
 * 弹窗登录成功后调用 resume 重试原请求，取消则直接 reject 原错误。
 */
export function runWithLoginRetry<T>(action: () => Promise<T>): Promise<T> {
  return action().catch((error: unknown) => {
    // 仅处理「服务端鉴权失败」的 401；非 401 或非浏览器环境直接向上抛
    if (!(error instanceof ApiRequestError) || error.status !== 401 || typeof window === "undefined") throw error;
    return new Promise<T>((resolve, reject) => {
      const request: PendingAuthRequest = {
        // 登录成功后重新执行原请求
        resume: () => action().then(resolve, reject),
        // 用户关闭弹窗/取消登录，则按原错误拒绝
        cancel: () => reject(error),
      };
      window.dispatchEvent(new CustomEvent<PendingAuthRequest>("auth-required", { detail: request }));
    });
  });
}

/**
 * 读取并解析接口响应：
 * - 失败（!ok）时抛出 ApiRequestError，兼容后端返回的 message/error/code；
 * - 成功时把 JSON body 作为泛型 T 返回。
 */
export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  let payload: { message?: unknown; error?: unknown; code?: unknown } & Record<string, unknown> = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // 服务端未返回 JSON（如网关报错页）时，保留 HTTP 状态码继续走错误分支
  }
  if (!response.ok) {
    const message = typeof payload.message === "string"
      ? payload.message
      : typeof payload.error === "string" ? payload.error : fallback;
    throw new ApiRequestError(
      message,
      response.status,
      typeof payload.code === "string" ? payload.code : undefined
    );
  }
  return payload as T;
}

/** 统一请求返回结构：成功携带 data，失败携带 errorMsg */
export type RequestResult<T> =
  | { success: true; data: T }
  | { success: false; errorMsg: string; data?: T };

type RequestOptions = { retryOnUnauthorized?: boolean };

/**
 * 客户端 fetch 请求封装，统一返回 { success, data | errorMsg }：
 * - 成功：{ success: true, data: T }
 * - 失败（业务错误、401 取消登录、网络错误）：{ success: false, errorMsg: string }
 * 业务请求的 401 会触发登录弹窗并自动重试；登录/注册请求关闭该行为，避免等待自身登录成功。
 * 失败时会直接调用 showToast 弹出错误提示。
 */
export async function request<T = unknown>(
  url: string,
  init: RequestInit = {},
  options: RequestOptions = {}
): Promise<RequestResult<T>> {
  try {
    const performRequest = async () => {
      const response = await fetch(url, { cache: "no-store", ...init });
      return readApiResponse<T>(response, "请求失败");
    };
    const data = options.retryOnUnauthorized === false
      ? await performRequest()
      : await runWithLoginRetry(performRequest);
    return { success: true, data };
  } catch (error) {
    const errorMsg = error instanceof ApiRequestError ? error.message : "网络请求失败";
    showToast(errorMsg);
    return { success: false, errorMsg };
  }
}
