import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { callAiQuoteCartTool } from "@/lib/mcp/tool-calls";
import { readSession } from "@/lib/auth/auth-server";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: randomUUID() }, { status });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return errorResponse(401, "UNAUTHENTICATED", "请先登录后查看 AI 报价。");
  let body: { cartVersion?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return errorResponse(400, "INVALID_JSON", "请求格式无效。"); }
  if (!body || !Number.isSafeInteger(body.cartVersion) || (body.cartVersion as number) < 1) return errorResponse(400, "INVALID_QUOTE_REQUEST", "AI 报价请求无效。");
  const result = await callAiQuoteCartTool({ cartVersion: body.cartVersion as number }, { userid: session.userid });
  if (!result.ok) {
    const status = ["CART_CHANGED", "CART_RESERVATION_EXPIRED", "OUT_OF_STOCK", "QUOTE_EXPIRED", "QUOTE_ALREADY_USED"].includes(result.error.code) ? 409 : result.error.retryable ? 503 : 400;
    return errorResponse(status, result.error.code, result.error.message);
  }
  return NextResponse.json(result.data);
}
