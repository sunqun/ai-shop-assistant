import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { callAiReconcileCartTool } from "@/lib/mcp/client";
import { readSession } from "@/lib/auth/auth-server";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: randomUUID() }, { status });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return errorResponse(401, "UNAUTHENTICATED", "请先登录后再选入 AI 购物车。");
  let body: { items?: unknown; idempotencyKey?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return errorResponse(400, "INVALID_JSON", "请求格式无效。"); }
  if (!body || !Array.isArray(body.items) || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 1 || body.idempotencyKey.length > 128) {
    return errorResponse(400, "INVALID_CART_REQUEST", "AI 购物车请求无效。");
  }
  const result = await callAiReconcileCartTool({ items: body.items as { id: string; quantity: number }[], idempotencyKey: body.idempotencyKey }, { userid: session.userid });
  if (!result.ok) return errorResponse(result.error.code === "IDEMPOTENCY_KEY_REUSED" ? 409 : result.error.retryable ? 503 : 400, result.error.code, result.error.message);
  return NextResponse.json(result.data);
}
