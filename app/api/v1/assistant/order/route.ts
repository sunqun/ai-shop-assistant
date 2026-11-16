import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth-server";
import { callAiSubmitOrderTool } from "@/lib/mcp/client";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: randomUUID() }, { status });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return errorResponse(401, "UNAUTHENTICATED", "请先登录后再提交订单。");
  let body: { cartToken?: unknown; cartVersion?: unknown; quoteId?: unknown; idempotencyKey?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return errorResponse(400, "INVALID_JSON", "请求格式无效。"); }
  if (!body || typeof body.cartToken !== "string" || !Number.isSafeInteger(body.cartVersion) || typeof body.quoteId !== "string" || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 1 || body.idempotencyKey.length > 128) return errorResponse(400, "INVALID_ORDER_REQUEST", "AI 下单请求无效。");
  const result = await callAiSubmitOrderTool({ cartToken: body.cartToken, cartVersion: body.cartVersion as number, quoteId: body.quoteId, idempotencyKey: body.idempotencyKey }, { userid: session.userid });
  if (!result.ok) {
    const status = result.error.code === "AUTHORIZATION_REQUIRED" ? 403 : result.error.code === "UNAUTHENTICATED" ? 401 : ["CART_CHANGED", "CART_RESERVATION_EXPIRED", "QUOTE_EXPIRED", "QUOTE_ALREADY_USED", "OUT_OF_STOCK", "IDEMPOTENCY_KEY_REUSED"].includes(result.error.code) ? 409 : result.error.retryable ? 503 : 400;
    return errorResponse(status, result.error.code, result.error.message);
  }
  return NextResponse.json(result.data);
}
