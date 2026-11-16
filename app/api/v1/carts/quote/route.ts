import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { deriveCartId } from "@/lib/cart-session";
import { getDbPool } from "@/lib/db";
import { calculateBestQuote } from "@/lib/pricing-domain";
import { getProduct } from "@/lib/products";

export const runtime = "nodejs";

type QuoteRequest = {
  cartToken?: unknown;
  cartVersion?: unknown;
};

type CartRow = RowDataPacket & {
  cart_id: string;
  source: "WEB" | "AI";
  cart_version: number;
  expires_at: Date | string | null;
};

type CartItemRow = RowDataPacket & {
  product_id: string;
  allocated_quantity: number;
  reserved_quantity: number | null;
  reservation_status: "ACTIVE" | "RELEASED" | "EXPIRED" | null;
  reservation_expires_at: Date | string | null;
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: randomUUID() }, { status });
}

function asDate(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request) {
  let body: QuoteRequest;
  try {
    body = (await request.json()) as QuoteRequest;
  } catch {
    return errorResponse(400, "INVALID_JSON", "请求格式无效。");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "INVALID_QUOTE_REQUEST", "报价请求无效。");
  }

  if (typeof body.cartToken !== "string" || !Number.isSafeInteger(body.cartVersion) || (body.cartVersion as number) < 1) {
    return errorResponse(400, "INVALID_QUOTE_REQUEST", "购物车凭证和版本不能为空。");
  }
  let cartId: string;
  try {
    cartId = deriveCartId(body.cartToken);
  } catch {
    return errorResponse(400, "INVALID_CART_TOKEN", "购物车会话已失效，请刷新后重试。");
  }

  let connection: Awaited<ReturnType<ReturnType<typeof getDbPool>["getConnection"]>> | null = null;
  try {
    connection = await getDbPool().getConnection();
    await connection.beginTransaction();
    const [cartRows] = await connection.query<CartRow[]>(
      "SELECT cart_id, source, cart_version, expires_at FROM carts WHERE cart_id = ? FOR UPDATE",
      [cartId]
    );
    const cart = cartRows[0];
    if (!cart) {
      await connection.rollback();
      return errorResponse(404, "CART_NOT_FOUND", "购物车不存在或已失效。");
    }
    if (Number(cart.cart_version) !== body.cartVersion) {
      await connection.rollback();
      return errorResponse(409, "CART_CHANGED", "购物车内容已变化，请重新校验库存并报价。");
    }
    const cartExpiresAt = asDate(cart.expires_at);
    if (!cartExpiresAt || cartExpiresAt.getTime() <= Date.now()) {
      await connection.rollback();
      return errorResponse(409, "CART_RESERVATION_EXPIRED", "库存锁定已过期，请重新校验库存。");
    }

    const [itemRows] = await connection.query<CartItemRow[]>(
      "SELECT s.product_id, ci.allocated_quantity, ir.reserved_quantity, ir.status AS reservation_status, ir.expires_at AS reservation_expires_at FROM cart_items ci INNER JOIN inventory_skus s ON s.sku_id = ci.sku_id LEFT JOIN inventory_reservations ir ON ir.cart_id = ci.cart_id AND ir.sku_id = ci.sku_id WHERE ci.cart_id = ? AND ci.allocated_quantity > 0 ORDER BY ci.sku_id FOR UPDATE",
      [cartId]
    );
    if (!itemRows.length) {
      await connection.rollback();
      return errorResponse(409, "OUT_OF_STOCK", "购物车中没有可报价的有货商品。");
    }

    let subtotalMinor = 0;
    for (const item of itemRows) {
      const reservationExpiresAt = asDate(item.reservation_expires_at);
      if (
        item.reservation_status !== "ACTIVE" ||
        Number(item.reserved_quantity) !== Number(item.allocated_quantity) ||
        !reservationExpiresAt ||
        reservationExpiresAt.getTime() <= Date.now()
      ) {
        await connection.rollback();
        return errorResponse(409, "CART_RESERVATION_EXPIRED", "库存锁定已过期，请重新校验库存。");
      }
      const product = getProduct(item.product_id);
      if (!product) {
        await connection.rollback();
        return errorResponse(503, "PRICING_CATALOG_UNAVAILABLE", "商品价格暂时无法确认。");
      }
      subtotalMinor += Math.trunc(product.price * 100) * Number(item.allocated_quantity);
    }

    const quote = calculateBestQuote({
      subtotalMinor,
      source: cart.source,
      aiSubtotalMinor: cart.source === "AI" ? subtotalMinor : 0,
    });
    const quoteExpiresAt = new Date(Math.min(Date.now() + 15 * 60 * 1000, cartExpiresAt.getTime()));
    const quoteId = randomUUID();
    await connection.execute(
      "INSERT INTO cart_quotes (quote_id, cart_id, cart_version, promotion, rule_version, subtotal_minor, discount_minor, shipping_minor, total_minor, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        quoteId,
        cartId,
        body.cartVersion,
        quote.selected.id,
        quote.ruleVersion,
        subtotalMinor,
        quote.selected.discountMinor,
        quote.selected.shippingMinor,
        quote.selected.totalMinor,
        quoteExpiresAt,
      ]
    );
    await connection.commit();

    return NextResponse.json({
      quote: {
        quoteId,
        cartVersion: body.cartVersion,
        currency: "TWD",
        subtotalMinor,
        discountMinor: quote.selected.discountMinor,
        shippingMinor: quote.selected.shippingMinor,
        totalDueMinor: quote.selected.totalMinor,
        promotion: quote.selected.id,
        label: quote.selected.label,
        ruleVersion: quote.ruleVersion,
        expiresAt: quoteExpiresAt.toISOString(),
        displayRounding: "nearest_nt_dollar",
      },
      appliedRules: quote.appliedRules,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error instanceof Error && error.message === "PROMOTION_NOT_APPLICABLE") {
      return errorResponse(400, "PROMOTION_NOT_APPLICABLE", "该优惠不适用于当前购物车。");
    }
    console.error("cart quote failed", error instanceof Error ? error.message : "unknown error");
    return errorResponse(503, "QUOTE_SERVICE_UNAVAILABLE", "报价服务暂时无法使用，请稍后重试。");
  } finally {
    connection?.release();
  }
}
