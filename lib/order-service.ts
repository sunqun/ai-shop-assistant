import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db";
import { deriveCartId } from "@/lib/cart-session";
import { getCatalogProducts } from "@/lib/catalog";
import type { AiOrderToolOutput } from "@/lib/mcp/types";

export class OrderServiceError extends Error {
  constructor(public readonly code: string) { super(code); }
}

type CartRow = RowDataPacket & { cart_id: string; source: "WEB" | "AI"; cart_version: number; expires_at: Date | string | null };
type QuoteRow = RowDataPacket & { quote_id: string; cart_id: string; cart_version: number; total_minor: number; expires_at: Date | string; consumed_at: Date | string | null };
type ItemRow = RowDataPacket & { sku_id: string; allocated_quantity: number; unavailable_quantity: number; product_id: string };

function dateValue(value: Date | string) { return value instanceof Date ? value : new Date(value); }

export async function submitAiOrder(input: { userid: string; cartToken: string; cartVersion: number; quoteId: string; idempotencyKey: string }): Promise<AiOrderToolOutput> {
  let cartId: string;
  try { cartId = deriveCartId(input.cartToken, "AI"); } catch (error) { throw new OrderServiceError(error instanceof Error && error.message === "CART_SESSION_UNAVAILABLE" ? "CART_SESSION_UNAVAILABLE" : "INVALID_CART_TOKEN"); }
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query<RowDataPacket[]>("SELECT order_group_id, cart_id, cart_version, quote_id, response_json FROM order_groups WHERE userid = ? AND idempotency_key = ? FOR UPDATE", [input.userid, input.idempotencyKey]);
    if (existing.length) {
      if (String(existing[0].cart_id) !== cartId || Number(existing[0].cart_version) !== input.cartVersion || String(existing[0].quote_id) !== input.quoteId) throw new OrderServiceError("IDEMPOTENCY_KEY_REUSED");
      if (existing[0].response_json) {
        await connection.commit();
        const stored = existing[0].response_json;
        return (typeof stored === "string" ? JSON.parse(stored) : stored) as AiOrderToolOutput;
      }
      const [groupRows] = await connection.query<RowDataPacket[]>("SELECT order_group_id FROM order_groups WHERE order_group_id = ?", [existing[0].order_group_id]);
      const [orderRows] = await connection.query<RowDataPacket[]>("SELECT order_id FROM orders WHERE order_group_id = ?", [existing[0].order_group_id]);
      await connection.commit();
      return { orderGroupId: String(groupRows[0].order_group_id), source: "AI", settlementStatus: "NOT_DUE", splitSummary: { split: false, shortageItems: [] }, orders: orderRows.map((row) => ({ orderId: String(row.order_id), fulfillmentStatus: "PLACED", settlementStatus: "NOT_DUE" })), audit: { provenance: "assistant", userId: input.userid } };
    }
    const [userRows] = await connection.query<RowDataPacket[]>("SELECT userid, is_authorized FROM users WHERE userid = ? FOR UPDATE", [input.userid]);
    if (!userRows.length) throw new OrderServiceError("UNAUTHENTICATED");
    if (!Boolean(userRows[0].is_authorized)) throw new OrderServiceError("AUTHORIZATION_REQUIRED");
    const [cartRows] = await connection.query<CartRow[]>("SELECT cart_id, source, cart_version, expires_at FROM carts WHERE cart_id = ? AND userid = ? FOR UPDATE", [cartId, input.userid]);
    const cart = cartRows[0];
    if (!cart || cart.source !== "AI") throw new OrderServiceError("CART_SOURCE_MISMATCH");
    if (Number(cart.cart_version) !== input.cartVersion) throw new OrderServiceError("CART_CHANGED");
    if (!cart.expires_at || dateValue(cart.expires_at).getTime() <= Date.now()) throw new OrderServiceError("CART_RESERVATION_EXPIRED");
    const [quoteRows] = await connection.query<QuoteRow[]>("SELECT quote_id, cart_id, cart_version, total_minor, expires_at, consumed_at FROM cart_quotes WHERE quote_id = ? AND cart_id = ? FOR UPDATE", [input.quoteId, cartId]);
    const quote = quoteRows[0];
    if (!quote || Number(quote.cart_version) !== input.cartVersion || dateValue(quote.expires_at).getTime() <= Date.now()) throw new OrderServiceError("QUOTE_EXPIRED");
    if (quote.consumed_at) throw new OrderServiceError("QUOTE_ALREADY_USED");
    const [itemRows] = await connection.query<ItemRow[]>("SELECT ci.sku_id, ci.allocated_quantity, ci.unavailable_quantity, s.product_id FROM cart_items ci INNER JOIN inventory_skus s ON s.sku_id = ci.sku_id WHERE ci.cart_id = ? AND ci.allocated_quantity > 0 FOR UPDATE", [cartId]);
    if (!itemRows.length) throw new OrderServiceError("OUT_OF_STOCK");
    const products = await getCatalogProducts(itemRows.map((item) => item.product_id));
    for (const item of itemRows) if (!products.get(item.product_id)) throw new OrderServiceError("PRICING_CATALOG_UNAVAILABLE");
    const orderGroupId = randomUUID();
    const orderId = randomUUID();
    await connection.execute("INSERT INTO order_groups (order_group_id, userid, cart_id, cart_version, source, quote_id, idempotency_key) VALUES (?, ?, ?, ?, 'AI', ?, ?)", [orderGroupId, input.userid, cartId, input.cartVersion, input.quoteId, input.idempotencyKey]);
    await connection.execute("INSERT INTO orders (order_id, order_group_id) VALUES (?, ?)", [orderId, orderGroupId]);
    for (const item of itemRows) await connection.execute("INSERT INTO order_items (order_id, sku_id, quantity, unit_price_minor) VALUES (?, ?, ?, ?)", [orderId, item.sku_id, item.allocated_quantity, Math.trunc(products.get(item.product_id)!.price * 100)]);
    const shortageItems = itemRows.filter((item) => Number(item.unavailable_quantity) > 0).map((item) => ({ skuId: item.sku_id, quantity: Number(item.unavailable_quantity) }));
    const response: AiOrderToolOutput = { orderGroupId, source: "AI", settlementStatus: "NOT_DUE", splitSummary: { split: shortageItems.length > 0, shortageItems }, orders: [{ orderId, fulfillmentStatus: "PLACED", settlementStatus: "NOT_DUE" }], audit: { provenance: "assistant", userId: input.userid } };
    await connection.execute("UPDATE cart_quotes SET consumed_at = CURRENT_TIMESTAMP(3) WHERE quote_id = ? AND consumed_at IS NULL", [input.quoteId]);
    await connection.execute("UPDATE order_groups SET response_json = ? WHERE order_group_id = ?", [JSON.stringify(response), orderGroupId]);
    await connection.execute("INSERT INTO order_audit_events (event_id, order_group_id, event_type, provenance, details_json) VALUES (?, ?, 'ORDER_CREATED', 'assistant', ?)", [randomUUID(), orderGroupId, JSON.stringify({ userId: input.userid, cartId, quoteId: input.quoteId, source: "AI" })]);
    await connection.commit();
    return response;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
