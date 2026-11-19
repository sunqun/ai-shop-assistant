import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "ai_shop_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

type SessionPayload = { userid: string; exp: number };

function sessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret) throw new Error("Missing required environment variable: AUTH_SESSION_SECRET");
  return secret;
}

export function assertSessionReady(): void {
  sessionSecret();
}

function encode(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function decode(value: string): SessionPayload | null {
  const [data, signature] = value.split(".");
  if (!data || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(data).digest("base64url");
  if (signature.length !== expected.length) return null;
  const signatureBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (signatureBytes.length !== expectedBytes.length) return null;
  if (!timingSafeEqual(signatureBytes, expectedBytes)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload;
    return payload.exp > Math.floor(Date.now() / 1000) && payload.userid ? payload : null;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<SessionPayload | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return null;
  try {
    return decode(value);
  } catch {
    return null;
  }
}

export async function setSession(userid: string): Promise<void> {
  (await cookies()).set(
    COOKIE_NAME,
    encode({ userid, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    }
  );
}

export async function clearSession(): Promise<void> {
  (await cookies()).set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
