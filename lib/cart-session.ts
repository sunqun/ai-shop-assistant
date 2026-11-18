import { createHmac } from "node:crypto";

export type CartSessionSource = "WEB" | "AI";

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deriveUserCartId(userid: string, source: CartSessionSource = "WEB"): string {
  if (!USER_ID_RE.test(userid)) throw new Error("INVALID_USER_ID");
  const secret = process.env.AUTH_SESSION_SECRET;
  // 本地环境已使用较长密钥；这里保持最小 16 字节，生产应使用更长的随机值。
  if (!secret || Buffer.byteLength(secret) < 16) throw new Error("CART_SESSION_UNAVAILABLE");
  return createHmac("sha256", secret).update(`cart-v3:${source}:${userid}`).digest("hex");
}
