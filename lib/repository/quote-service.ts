import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { deriveUserCartId } from "@/lib/repository/cart-session";
import { getDbPool } from "@/lib/repository/db";
import { calculateBestQuote, lineSubtotalMinor } from "@/lib/pricing-domain";
import { getCatalogProducts } from "@/lib/catalog";
import type { QuoteToolOutput } from "@/lib/mcp/types";
import { promotionAAvailable, isConversationShoppingTask } from "./promotion-eligibility";

type CartRow = RowDataPacket & {
  cart_id: string;
  source: "WEB" | "AI";
  cart_version: number;
  expires_at: Date | string | null;
};
type CartItemRow = RowDataPacket & {
  sku_id: string;
  product_id: string;
  allocated_quantity: number;
  reserved_quantity: number | null;
  reservation_status: string | null;
  reservation_expires_at: Date | string | null;
};

// 报价服务统一抛出的业务错误，code 用于上层映射为具体响应。
export class QuoteServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

// 将数据库返回的日期字段统一解析为 Date，空值或非法日期返回 null。
function asDate(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// 为购物车生成报价：
// 1. 按用户与来源推导购物车 ID，锁定购物车及其条目。
// 2. 校验购物车来源、版本、有效期，以及每条目的库存预留状态。
// 3. 汇总小计金额，计算最优报价规则，写入报价记录并返回结果。
export async function quoteCart(input: {
  userid: string;
  cartVersion: number;
  expectedSource?: "WEB" | "AI";
  selectedSkuIds?: string[];
  shoppingTaskId?: string;
}): Promise<QuoteToolOutput> {
  let cartId: string;
  try {
    cartId = deriveUserCartId(input.userid, input.expectedSource ?? "WEB");
  } catch {
    throw new QuoteServiceError("CART_SESSION_UNAVAILABLE");
  }
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    // 与下单保持 users → carts 的加锁顺序，统一账号优惠资格。
    const [users] = await connection.query<RowDataPacket[]>("SELECT userid FROM users WHERE userid = ? FOR UPDATE", [input.userid]);
    if (!users.length) throw new QuoteServiceError("UNAUTHENTICATED");
    // 使用 FOR UPDATE 锁定购物车行，避免报价期间购物车被并发修改。
    const [cartRows] = await connection.query<CartRow[]>(
      "SELECT cart_id, source, cart_version, expires_at FROM carts WHERE cart_id = ? AND userid = ? FOR UPDATE",
      [cartId, input.userid]
    );
    const cart = cartRows[0];
    if (!cart) throw new QuoteServiceError("CART_NOT_FOUND");
    if (input.expectedSource && cart.source !== input.expectedSource)
      throw new QuoteServiceError("CART_SOURCE_MISMATCH");
    if (Number(cart.cart_version) !== input.cartVersion)
      throw new QuoteServiceError("CART_CHANGED");
    const cartExpiresAt = asDate(cart.expires_at);
    if (!cartExpiresAt || cartExpiresAt.getTime() <= Date.now())
      throw new QuoteServiceError("CART_RESERVATION_EXPIRED");
    // 仅取仍有分配数量的条目，并锁定其预留记录，确保价格基于有效库存计算。
    const [availableRows] = await connection.query<CartItemRow[]>(
      "SELECT ci.sku_id, s.product_id, ci.allocated_quantity, ir.reserved_quantity, ir.status AS reservation_status, ir.expires_at AS reservation_expires_at FROM cart_items ci INNER JOIN inventory_skus s ON s.sku_id = ci.sku_id LEFT JOIN inventory_reservations ir ON ir.cart_id = ci.cart_id AND ir.sku_id = ci.sku_id WHERE ci.cart_id = ? AND ci.allocated_quantity > 0 ORDER BY ci.sku_id FOR UPDATE",
      [cartId]
    );
    const selection = input.selectedSkuIds === undefined ? null : new Set(input.selectedSkuIds);
    if (selection && (!selection.size || selection.size !== input.selectedSkuIds!.length ||
        [...selection].some((sku) => !availableRows.some((item) => item.sku_id === sku))))
      throw new QuoteServiceError("INVALID_CART_SELECTION");
    const itemRows = selection ? availableRows.filter((item) => selection.has(item.sku_id)) : availableRows;
    if (!itemRows.length) throw new QuoteServiceError("OUT_OF_STOCK");
    const products = await getCatalogProducts(itemRows.map((item) => item.product_id));
    let subtotalMinor = 0;
    for (const item of itemRows) {
      const reservationExpiresAt = asDate(item.reservation_expires_at);
      // 预留必须仍处于 ACTIVE 状态、数量一致且未过期，否则视为购物车过期。
      if (
        item.reservation_status !== "ACTIVE" ||
        Number(item.reserved_quantity) !== Number(item.allocated_quantity) ||
        !reservationExpiresAt ||
        reservationExpiresAt.getTime() <= Date.now()
      )
        throw new QuoteServiceError("CART_RESERVATION_EXPIRED");
      const product = products.get(item.product_id);
      if (!product) throw new QuoteServiceError("PRICING_CATALOG_UNAVAILABLE");
      subtotalMinor += lineSubtotalMinor(product.price, Number(item.allocated_quantity));
    }
    const availableA = await promotionAAvailable(connection, input.userid);
    const eligibleC = cart.source === "AI" && await isConversationShoppingTask(connection, input.userid, input.shoppingTaskId);
    const quote = calculateBestQuote({
      subtotalMinor,
      source: cart.source,
      aiSubtotalMinor: cart.source === "AI" ? subtotalMinor : 0,
      promotionAAvailable: availableA,
      aiOrderEligible: eligibleC,
    });
    // 报价有效期取 15 分钟与购物车过期时间的较小值，确保两者同步失效。
    const quoteExpiresAt = new Date(Math.min(Date.now() + 15 * 60 * 1000, cartExpiresAt.getTime()));
    const quoteId = randomUUID();
    await connection.execute(
      "INSERT INTO cart_quotes (quote_id, cart_id, cart_version, promotion, rule_version, subtotal_minor, discount_minor, shipping_minor, total_minor, expires_at, selected_sku_ids, shopping_task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        quoteId,
        cartId,
        input.cartVersion,
        quote.selected.id,
        quote.ruleVersion,
        subtotalMinor,
        quote.selected.discountMinor,
        quote.selected.shippingMinor,
        quote.selected.totalMinor,
        quoteExpiresAt,
        selection ? JSON.stringify(itemRows.map((item) => item.sku_id)) : null,
        input.shoppingTaskId ?? null,
      ]
    );
    await connection.commit();
    return {
      quote: {
        quoteId,
        cartId,
        cartVersion: input.cartVersion,
        currency: "TWD",
        subtotalMinor,
        discountMinor: quote.selected.discountMinor,
        shippingMinor: quote.selected.shippingMinor,
        totalDueMinor: quote.selected.totalMinor,
        promotion: quote.selected.id,
        label: quote.selected.label,
        ruleVersion: quote.ruleVersion,
        expiresAt: quoteExpiresAt.toISOString(),
      },
      appliedRules: quote.appliedRules,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
