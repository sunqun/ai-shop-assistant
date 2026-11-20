import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CartServiceError, reconcileCart } from "@/lib/repository/cart-service";
import { readSession } from "@/lib/auth/auth-server";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: randomUUID() }, { status });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return errorResponse(401, "UNAUTHENTICATED", "请先登录后再加入购物车。");
  let body: { items?: unknown; idempotencyKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(400, "INVALID_JSON", "请求格式无效。");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "INVALID_CART_REQUEST", "购物车请求无效。");
  }
  if (
    typeof body.idempotencyKey !== "string" ||
    body.idempotencyKey.length < 1 ||
    body.idempotencyKey.length > 128
  ) {
    return errorResponse(400, "INVALID_CART_REQUEST", "幂等键不能为空。");
  }
  if (!Array.isArray(body.items)) return errorResponse(400, "INVALID_CART_ITEMS", "购物车商品列表无效。");

  try {
    return NextResponse.json(
      await reconcileCart({
        userid: session.userid,
        items: body.items,
        idempotencyKey: body.idempotencyKey,
        source: "WEB",
      })
    );
  } catch (error) {
    if (error instanceof CartServiceError) {
      const messages: Record<string, string> = {
        INVALID_CART_TOKEN: "购物车会话已失效，请刷新后重试。",
        CART_SESSION_UNAVAILABLE: "购物车服务配置暂不可用，请稍后重试。",
        INVALID_CART_ITEMS: "购物车商品或数量无效。",
        IDEMPOTENCY_KEY_REUSED: "相同幂等键不能提交不同购物车内容。",
        CART_OWNER_MISMATCH: "购物车不属于当前登录用户。",
        CART_SOURCE_MISMATCH: "购物车来源无效。",
      };
      const status = error.code === "CART_SESSION_UNAVAILABLE" ? 503 : error.code === "IDEMPOTENCY_KEY_REUSED" || error.code === "CART_OWNER_MISMATCH" || error.code === "CART_SOURCE_MISMATCH" ? 409 : 400;
      return errorResponse(status, error.code, messages[error.code] ?? "购物车请求无效。");
    }
    console.error("cart reconcile failed", error instanceof Error ? error.message : "unknown error");
    return errorResponse(503, "CART_SERVICE_UNAVAILABLE", "库存服务暂时无法使用，请稍后重试。");
  }
}
