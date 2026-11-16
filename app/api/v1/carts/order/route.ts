import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth-server";
import { OrderServiceError, submitWebOrder } from "@/lib/order-service";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: randomUUID() }, { status });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return errorResponse(401, "UNAUTHENTICATED", "请先登录后再创建订单。");
  let body: { cartToken?: unknown; cartVersion?: unknown; quoteId?: unknown; idempotencyKey?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return errorResponse(400, "INVALID_JSON", "请求格式无效。"); }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.cartToken !== "string" || !Number.isSafeInteger(body.cartVersion) || (body.cartVersion as number) < 1 || typeof body.quoteId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.quoteId) || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.idempotencyKey)) {
    return errorResponse(400, "INVALID_ORDER_REQUEST", "订单请求无效，请重新确认购物车。");
  }
  try {
    return NextResponse.json(await submitWebOrder({ userid: session.userid, cartToken: body.cartToken, cartVersion: body.cartVersion as number, quoteId: body.quoteId, idempotencyKey: body.idempotencyKey }));
  } catch (error) {
    if (error instanceof OrderServiceError) {
      const conflicts = ["CART_CHANGED", "CART_RESERVATION_EXPIRED", "QUOTE_EXPIRED", "QUOTE_ALREADY_USED", "OUT_OF_STOCK", "IDEMPOTENCY_KEY_REUSED"];
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "AUTHORIZATION_REQUIRED" ? 403 : conflicts.includes(error.code) ? 409 : ["CART_SESSION_UNAVAILABLE", "PRICING_CATALOG_UNAVAILABLE"].includes(error.code) ? 503 : 400;
      const messages: Record<string, string> = {
        UNAUTHENTICATED: "请先登录后再创建订单。", AUTHORIZATION_REQUIRED: "请先完成 AI 自助下单授权。", CART_SOURCE_MISMATCH: "购物车来源无效。", CART_CHANGED: "购物车已变化，请返回重新确认。", CART_RESERVATION_EXPIRED: "库存确认已过期，请返回购物车重新确认。", QUOTE_EXPIRED: "报价已过期，请返回购物车重新报价。", QUOTE_ALREADY_USED: "此报价已创建过订单，请重新报价。", OUT_OF_STOCK: "当前没有可创建订单的商品。", IDEMPOTENCY_KEY_REUSED: "订单请求已变化，请重新提交。", INVALID_CART_TOKEN: "购物车会话已失效，请刷新后重试。", CART_SESSION_UNAVAILABLE: "订单服务暂时不可用。", PRICING_CATALOG_UNAVAILABLE: "商品信息暂时不可用。",
      };
      return errorResponse(status, error.code, messages[error.code] ?? "订单创建失败，请稍后重试。");
    }
    console.error("web order creation failed", error instanceof Error ? error.message : "unknown error");
    return errorResponse(503, "ORDER_SERVICE_UNAVAILABLE", "订单服务暂时不可用，请稍后重试。");
  }
}
