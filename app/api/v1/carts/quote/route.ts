import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { QuoteServiceError, quoteCart } from "@/lib/repository/quote-service";
import { readSession } from "@/lib/auth/auth-server";

export const runtime = "nodejs";

type QuoteRequest = {
  cartVersion?: unknown;
  selectedSkuIds?: unknown;
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: randomUUID() }, { status });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return errorResponse(401, "UNAUTHENTICATED", "请先登录后再查看购物车报价。");
  let body: QuoteRequest;
  try {
    body = (await request.json()) as QuoteRequest;
  } catch {
    return errorResponse(400, "INVALID_JSON", "请求格式无效。");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "INVALID_QUOTE_REQUEST", "报价请求无效。");
  }

  if (!Number.isSafeInteger(body.cartVersion) || (body.cartVersion as number) < 1) {
    return errorResponse(400, "INVALID_QUOTE_REQUEST", "购物车版本不能为空。");
  }
  if (body.selectedSkuIds !== undefined && (!Array.isArray(body.selectedSkuIds) ||
      body.selectedSkuIds.length === 0 || body.selectedSkuIds.length > 1000 ||
      body.selectedSkuIds.some((sku) => typeof sku !== "string" || !sku.length || sku.length > 100) ||
      new Set(body.selectedSkuIds).size !== body.selectedSkuIds.length))
    return errorResponse(400, "INVALID_CART_SELECTION", "请勾选有效的购物车商品。");
  try {
    return NextResponse.json(await quoteCart({ userid: session.userid, cartVersion: body.cartVersion as number, expectedSource: "WEB", selectedSkuIds: body.selectedSkuIds as string[] | undefined }));
  } catch (error) {
    if (error instanceof QuoteServiceError) {
      const status = error.code === "CART_NOT_FOUND" ? 404 : ["CART_CHANGED", "CART_RESERVATION_EXPIRED", "OUT_OF_STOCK"].includes(error.code) ? 409 : error.code === "PRICING_CATALOG_UNAVAILABLE" ? 503 : 400;
      return errorResponse(status, error.code, ({ CART_NOT_FOUND: "购物车不存在或已失效。", CART_CHANGED: "购物车内容已变化，请重新校验库存并报价。", CART_RESERVATION_EXPIRED: "库存锁定已过期，请重新校验库存。", OUT_OF_STOCK: "购物车中没有可报价的有货商品。", INVALID_CART_TOKEN: "购物车会话已失效，请刷新后重试。" } as Record<string, string>)[error.code] ?? "报价请求无效。");
    }
    console.error("cart quote failed", error instanceof Error ? error.message : "unknown error");
    return errorResponse(503, "QUOTE_SERVICE_UNAVAILABLE", "报价服务暂时无法使用，请稍后重试。");
  }
}
