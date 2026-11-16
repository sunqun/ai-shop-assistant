import { createHmac, timingSafeEqual } from "node:crypto";

export type CartSessionSource = "WEB" | "AI";

export function deriveCartId(token: string, source: CartSessionSource = "WEB"): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("INVALID_CART_TOKEN");
  const secret = process.env.AUTH_SESSION_SECRET;
  // The local environment already uses a 28-byte secret; keep the minimum at
  // 16 bytes here while production deployments should use a longer random value.
  if (!secret || Buffer.byteLength(secret) < 16) throw new Error("CART_SESSION_UNAVAILABLE");
  return createHmac("sha256", secret).update(`cart-v2:${source}:${token}`).digest("hex");
}

export function isCartTokenValid(token: string): boolean {
  try {
    const first = deriveCartId(token);
    const second = deriveCartId(`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`);
    return !timingSafeEqual(Buffer.from(first), Buffer.from(second));
  } catch {
    return false;
  }
}

