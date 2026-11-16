export class ApiRequestError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

type PendingAuthRequest = { resume: () => void; cancel: () => void };

export function runWithLoginRetry<T>(action: () => Promise<T>): Promise<T> {
  return action().catch((error: unknown) => {
    if (!(error instanceof ApiRequestError) || error.status !== 401 || typeof window === "undefined") throw error;
    return new Promise<T>((resolve, reject) => {
      const request: PendingAuthRequest = {
        resume: () => action().then(resolve, reject),
        cancel: () => reject(error),
      };
      window.dispatchEvent(new CustomEvent<PendingAuthRequest>("auth-required", { detail: request }));
    });
  });
}

export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  let payload: { message?: unknown; code?: unknown } & Record<string, unknown> = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // Keep the HTTP status when the server did not return JSON.
  }
  if (!response.ok) {
    throw new ApiRequestError(
      typeof payload.message === "string" ? payload.message : fallback,
      response.status,
      typeof payload.code === "string" ? payload.code : undefined
    );
  }
  return payload as T;
}
