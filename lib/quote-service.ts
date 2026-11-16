import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { deriveCartId } from "@/lib/cart-session";
import { getDbPool } from "@/lib/db";
import { calculateBestQuote } from "@/lib/pricing-domain";
import { getCatalogProducts } from "@/lib/catalog";
import type { AiQuoteToolOutput } from "@/lib/mcp/types";

type CartRow = RowDataPacket & { cart_id: string; source: "WEB" | "AI"; cart_version: number; expires_at: Date | string | null };
type CartItemRow = RowDataPacket & { sku_id: string; product_id: string; allocated_quantity: number; reserved_quantity: number | null; reservation_status: string | null; reservation_expires_at: Date | string | null };

export class QuoteServiceError extends Error {
  constructor(public readonly code: string) { super(code); }
}

function asDate(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function quoteCart(input: { userid: string; cartToken: string; cartVersion: number; expectedSource?: "WEB" | "AI" }): Promise<AiQuoteToolOutput> {
  let cartId: string;
  try { cartId = deriveCartId(input.cartToken, input.expectedSource ?? "WEB"); } catch (error) { throw new QuoteServiceError(error instanceof Error && error.message === "CART_SESSION_UNAVAILABLE" ? "CART_SESSION_UNAVAILABLE" : "INVALID_CART_TOKEN"); }
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [cartRows] = await connection.query<CartRow[]>("SELECT cart_id, source, cart_version, expires_at FROM carts WHERE cart_id = ? AND userid = ? FOR UPDATE", [cartId, input.userid]);
    const cart = cartRows[0];
    if (!cart) throw new QuoteServiceError("CART_NOT_FOUND");
    if (input.expectedSource && cart.source !== input.expectedSource) throw new QuoteServiceError("CART_SOURCE_MISMATCH");
    if (Number(cart.cart_version) !== input.cartVersion) throw new QuoteServiceError("CART_CHANGED");
    const cartExpiresAt = asDate(cart.expires_at);
    if (!cartExpiresAt || cartExpiresAt.getTime() <= Date.now()) throw new QuoteServiceError("CART_RESERVATION_EXPIRED");
    const [itemRows] = await connection.query<CartItemRow[]>("SELECT ci.sku_id, s.product_id, ci.allocated_quantity, ir.reserved_quantity, ir.status AS reservation_status, ir.expires_at AS reservation_expires_at FROM cart_items ci INNER JOIN inventory_skus s ON s.sku_id = ci.sku_id LEFT JOIN inventory_reservations ir ON ir.cart_id = ci.cart_id AND ir.sku_id = ci.sku_id WHERE ci.cart_id = ? AND ci.allocated_quantity > 0 ORDER BY ci.sku_id FOR UPDATE", [cartId]);
    if (!itemRows.length) throw new QuoteServiceError("OUT_OF_STOCK");
    const products = await getCatalogProducts(itemRows.map((item) => item.product_id));
    let subtotalMinor = 0;
    for (const item of itemRows) {
      const reservationExpiresAt = asDate(item.reservation_expires_at);
      if (item.reservation_status !== "ACTIVE" || Number(item.reserved_quantity) !== Number(item.allocated_quantity) || !reservationExpiresAt || reservationExpiresAt.getTime() <= Date.now()) throw new QuoteServiceError("CART_RESERVATION_EXPIRED");
      const product = products.get(item.product_id);
      if (!product) throw new QuoteServiceError("PRICING_CATALOG_UNAVAILABLE");
      subtotalMinor += Math.trunc(product.price * 100) * Number(item.allocated_quantity);
    }
    const quote = calculateBestQuote({ subtotalMinor, source: cart.source, aiSubtotalMinor: cart.source === "AI" ? subtotalMinor : 0 });
    const quoteExpiresAt = new Date(Math.min(Date.now() + 15 * 60 * 1000, cartExpiresAt.getTime()));
    const quoteId = randomUUID();
    await connection.execute("INSERT INTO cart_quotes (quote_id, cart_id, cart_version, promotion, rule_version, subtotal_minor, discount_minor, shipping_minor, total_minor, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [quoteId, cartId, input.cartVersion, quote.selected.id, quote.ruleVersion, subtotalMinor, quote.selected.discountMinor, quote.selected.shippingMinor, quote.selected.totalMinor, quoteExpiresAt]);
    await connection.commit();
    return { quote: { quoteId, cartId, cartVersion: input.cartVersion, currency: "TWD", subtotalMinor, discountMinor: quote.selected.discountMinor, shippingMinor: quote.selected.shippingMinor, totalDueMinor: quote.selected.totalMinor, promotion: quote.selected.id, label: quote.selected.label, ruleVersion: quote.ruleVersion, expiresAt: quoteExpiresAt.toISOString() }, appliedRules: quote.appliedRules };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
