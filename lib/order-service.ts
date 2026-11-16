import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db";
import { deriveCartId } from "@/lib/cart-session";
import { getCatalogProducts } from "@/lib/catalog";
import { lineSubtotalMinor, toMinor } from "@/lib/pricing-domain";
import type { AiOrderToolOutput, WebOrderToolOutput } from "@/lib/mcp/types";

export class OrderServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

type CartRow = RowDataPacket & {
  cart_id: string;
  source: "WEB" | "AI";
  cart_version: number;
  expires_at: Date | string | null;
};
type QuoteRow = RowDataPacket & {
  quote_id: string;
  cart_id: string;
  cart_version: number;
  subtotal_minor: number;
  total_minor: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
};
type ItemRow = RowDataPacket & {
  sku_id: string;
  allocated_quantity: number;
  unavailable_quantity: number;
  product_id: string;
};
type ReservationRow = RowDataPacket & {
  sku_id: string;
  reserved_quantity: number;
  status: "ACTIVE" | "RELEASED" | "EXPIRED" | "CONSUMED";
  expires_at: Date | string | null;
  on_hand: number;
  reserved: number;
};
type OrderListRow = RowDataPacket & {
  order_group_id: string;
  source: "WEB" | "AI";
  created_at: Date | string;
  subtotal_minor: number | string;
  discount_minor: number | string;
  shipping_minor: number | string;
  total_minor: number | string;
  order_id: string;
  sku_id: string;
  quantity: number;
  unit_price_minor: number | string;
  product_name: string | null;
};

export type UserOrderView = {
  orderGroupId: string;
  source: "WEB" | "AI";
  createdAt: string;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  totalMinor: number;
  items: Array<{ skuId: string; productName: string; quantity: number; unitPriceMinor: number }>;
};

function dateValue(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

async function consumeReservedInventory(
  connection: PoolConnection,
  cartId: string,
  itemRows: ItemRow[],
  requestKey: string
) {
  const skuIds = itemRows.map((item) => item.sku_id);
  const [reservationRows] = await connection.query<ReservationRow[]>(
    `SELECT ir.sku_id, ir.reserved_quantity, ir.status, ir.expires_at,
            s.on_hand, s.reserved
       FROM inventory_reservations ir
       INNER JOIN inventory_skus s ON s.sku_id = ir.sku_id
      WHERE ir.cart_id = ? AND ir.sku_id IN (?)
      ORDER BY ir.sku_id
      FOR UPDATE`,
    [cartId, skuIds]
  );
  const reservations = new Map(reservationRows.map((row) => [String(row.sku_id), row]));
  if (reservations.size !== itemRows.length) throw new OrderServiceError("OUT_OF_STOCK");

  for (const item of itemRows) {
    const reservation = reservations.get(String(item.sku_id));
    const quantity = Number(item.allocated_quantity);
    const expiresAt = reservation?.expires_at ? dateValue(reservation.expires_at) : null;
    if (
      !reservation ||
      reservation.status !== "ACTIVE" ||
      Number(reservation.reserved_quantity) !== quantity ||
      !expiresAt ||
      expiresAt.getTime() <= Date.now()
    ) {
      throw new OrderServiceError("CART_RESERVATION_EXPIRED");
    }

    const [inventoryUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE inventory_skus
          SET on_hand = on_hand - ?, reserved = reserved - ?, version = version + 1
        WHERE sku_id = ? AND on_hand >= ? AND reserved >= ?`,
      [quantity, quantity, item.sku_id, quantity, quantity]
    );
    if (inventoryUpdate.affectedRows !== 1) throw new OrderServiceError("OUT_OF_STOCK");

    const [reservationUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE inventory_reservations
          SET status = 'CONSUMED', updated_at = CURRENT_TIMESTAMP
        WHERE cart_id = ? AND sku_id = ? AND status = 'ACTIVE'`,
      [cartId, item.sku_id]
    );
    if (reservationUpdate.affectedRows !== 1) throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");

    await connection.execute(
      `INSERT INTO inventory_reservation_events
        (event_id, cart_id, sku_id, event_type, quantity, request_key)
       VALUES (?, ?, ?, 'CONSUMED', ?, ?)`,
      [randomUUID(), cartId, item.sku_id, quantity, requestKey]
    );
  }
}

async function readOrderViews(userid: string, orderGroupId?: string): Promise<UserOrderView[]> {
  const pool = getDbPool();
  const [rows] = await pool.query<OrderListRow[]>(
    `SELECT og.order_group_id, og.source, og.created_at,
            q.subtotal_minor, q.discount_minor, q.shipping_minor, q.total_minor,
            o.order_id, oi.sku_id, oi.quantity, oi.unit_price_minor, p.name AS product_name
       FROM order_groups og
       INNER JOIN cart_quotes q ON q.quote_id = og.quote_id
       INNER JOIN orders o ON o.order_group_id = og.order_group_id
       INNER JOIN order_items oi ON oi.order_id = o.order_id
       LEFT JOIN inventory_skus s ON s.sku_id = oi.sku_id
       LEFT JOIN products p ON p.product_id = s.product_id
      WHERE og.userid = ? ${orderGroupId ? "AND og.order_group_id = ?" : ""}
      ORDER BY og.created_at DESC, og.order_group_id DESC, oi.sku_id ASC`,
    orderGroupId ? [userid, orderGroupId] : [userid]
  );
  const groups = new Map<string, UserOrderView>();
  for (const row of rows) {
    const id = String(row.order_group_id);
    let group = groups.get(id);
    if (!group) {
      group = {
        orderGroupId: id,
        source: row.source,
        createdAt: dateValue(row.created_at).toISOString(),
        subtotalMinor: Number(row.subtotal_minor),
        discountMinor: Number(row.discount_minor),
        shippingMinor: Number(row.shipping_minor),
        totalMinor: Number(row.total_minor),
        items: [],
      };
      groups.set(id, group);
    }
    group.items.push({
      skuId: String(row.sku_id),
      productName: row.product_name ?? String(row.sku_id),
      quantity: Number(row.quantity),
      unitPriceMinor: Number(row.unit_price_minor),
    });
  }
  return [...groups.values()];
}

export async function listUserOrders(userid: string): Promise<UserOrderView[]> {
  return readOrderViews(userid);
}

export async function getUserOrder(
  userid: string,
  orderGroupId: string
): Promise<UserOrderView | null> {
  return (await readOrderViews(userid, orderGroupId))[0] ?? null;
}

export async function submitWebOrder(input: {
  userid: string;
  cartToken: string;
  cartVersion: number;
  quoteId: string;
  idempotencyKey: string;
}): Promise<WebOrderToolOutput> {
  let cartId: string;
  try {
    cartId = deriveCartId(input.cartToken, "WEB");
  } catch (error) {
    throw new OrderServiceError(
      error instanceof Error && error.message === "CART_SESSION_UNAVAILABLE"
        ? "CART_SESSION_UNAVAILABLE"
        : "INVALID_CART_TOKEN"
    );
  }
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT order_group_id, cart_id, cart_version, quote_id, response_json FROM order_groups WHERE userid = ? AND idempotency_key = ? FOR UPDATE",
      [input.userid, input.idempotencyKey]
    );
    if (existing.length) {
      if (
        String(existing[0].cart_id) !== cartId ||
        Number(existing[0].cart_version) !== input.cartVersion ||
        String(existing[0].quote_id) !== input.quoteId
      )
        throw new OrderServiceError("IDEMPOTENCY_KEY_REUSED");
      if (existing[0].response_json) {
        await connection.commit();
        const stored = existing[0].response_json;
        return (typeof stored === "string" ? JSON.parse(stored) : stored) as WebOrderToolOutput;
      }
      const [orderRows] = await connection.query<RowDataPacket[]>(
        "SELECT order_id FROM orders WHERE order_group_id = ?",
        [existing[0].order_group_id]
      );
      await connection.commit();
      return {
        orderGroupId: String(existing[0].order_group_id),
        source: "WEB",
        audit: { provenance: "web", userId: input.userid },
        orders: orderRows.map((row) => ({ orderId: String(row.order_id) })),
      };
    }
    const [userRows] = await connection.query<RowDataPacket[]>(
      "SELECT userid, is_authorized FROM users WHERE userid = ? FOR UPDATE",
      [input.userid]
    );
    if (!userRows.length) throw new OrderServiceError("UNAUTHENTICATED");
    if (!Boolean(userRows[0].is_authorized)) throw new OrderServiceError("AUTHORIZATION_REQUIRED");
    const [cartRows] = await connection.query<CartRow[]>(
      "SELECT cart_id, source, cart_version, expires_at FROM carts WHERE cart_id = ? AND userid = ? FOR UPDATE",
      [cartId, input.userid]
    );
    const cart = cartRows[0];
    if (!cart || cart.source !== "WEB") throw new OrderServiceError("CART_SOURCE_MISMATCH");
    if (Number(cart.cart_version) !== input.cartVersion)
      throw new OrderServiceError("CART_CHANGED");
    if (!cart.expires_at || dateValue(cart.expires_at).getTime() <= Date.now())
      throw new OrderServiceError("CART_RESERVATION_EXPIRED");
    const [quoteRows] = await connection.query<QuoteRow[]>(
      "SELECT quote_id, cart_id, cart_version, subtotal_minor, total_minor, expires_at, consumed_at FROM cart_quotes WHERE quote_id = ? AND cart_id = ? FOR UPDATE",
      [input.quoteId, cartId]
    );
    const quote = quoteRows[0];
    if (
      !quote ||
      Number(quote.cart_version) !== input.cartVersion ||
      dateValue(quote.expires_at).getTime() <= Date.now()
    )
      throw new OrderServiceError("QUOTE_EXPIRED");
    if (quote.consumed_at) throw new OrderServiceError("QUOTE_ALREADY_USED");
    const [itemRows] = await connection.query<ItemRow[]>(
      "SELECT ci.sku_id, ci.allocated_quantity, ci.unavailable_quantity, s.product_id FROM cart_items ci INNER JOIN inventory_skus s ON s.sku_id = ci.sku_id WHERE ci.cart_id = ? AND ci.allocated_quantity > 0 ORDER BY ci.sku_id FOR UPDATE",
      [cartId]
    );
    if (!itemRows.length) throw new OrderServiceError("OUT_OF_STOCK");
    const products = await getCatalogProducts(itemRows.map((item) => item.product_id));
    for (const item of itemRows)
      if (!products.get(item.product_id))
        throw new OrderServiceError("PRICING_CATALOG_UNAVAILABLE");
    const currentSubtotalMinor = itemRows.reduce(
      (sum, item) =>
        sum + lineSubtotalMinor(products.get(item.product_id)!.price, Number(item.allocated_quantity)),
      0
    );
    if (currentSubtotalMinor !== Number(quote.subtotal_minor))
      throw new OrderServiceError("QUOTE_EXPIRED");
    await consumeReservedInventory(connection, cartId, itemRows, input.idempotencyKey);
    const orderGroupId = randomUUID();
    const orderId = randomUUID();
    await connection.execute(
      "INSERT INTO order_groups (order_group_id, userid, cart_id, cart_version, source, quote_id, idempotency_key) VALUES (?, ?, ?, ?, 'WEB', ?, ?)",
      [orderGroupId, input.userid, cartId, input.cartVersion, input.quoteId, input.idempotencyKey]
    );
    await connection.execute("INSERT INTO orders (order_id, order_group_id) VALUES (?, ?)", [
      orderId,
      orderGroupId,
    ]);
    for (const item of itemRows)
      await connection.execute(
        "INSERT INTO order_items (order_id, sku_id, quantity, unit_price_minor) VALUES (?, ?, ?, ?)",
        [
          orderId,
          item.sku_id,
          item.allocated_quantity,
          toMinor(products.get(item.product_id)!.price),
        ]
      );
    const response: WebOrderToolOutput = {
      orderGroupId,
      source: "WEB",
      audit: { provenance: "web", userId: input.userid },
      orders: [{ orderId }],
    };
    await connection.execute(
      "UPDATE cart_quotes SET consumed_at = CURRENT_TIMESTAMP(3) WHERE quote_id = ? AND consumed_at IS NULL",
      [input.quoteId]
    );
    await connection.execute("UPDATE order_groups SET response_json = ? WHERE order_group_id = ?", [
      JSON.stringify(response),
      orderGroupId,
    ]);
    await connection.execute(
      "INSERT INTO order_audit_events (event_id, order_group_id, event_type, provenance, details_json) VALUES (?, ?, 'ORDER_CREATED', 'web', ?)",
      [
        randomUUID(),
        orderGroupId,
        JSON.stringify({ userId: input.userid, cartId, quoteId: input.quoteId, source: "WEB" }),
      ]
    );
    await connection.commit();
    return response;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function submitAiOrder(input: {
  userid: string;
  cartToken: string;
  cartVersion: number;
  quoteId: string;
  idempotencyKey: string;
}): Promise<AiOrderToolOutput> {
  let cartId: string;
  try {
    cartId = deriveCartId(input.cartToken, "AI");
  } catch (error) {
    throw new OrderServiceError(
      error instanceof Error && error.message === "CART_SESSION_UNAVAILABLE"
        ? "CART_SESSION_UNAVAILABLE"
        : "INVALID_CART_TOKEN"
    );
  }
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT order_group_id, cart_id, cart_version, quote_id, response_json FROM order_groups WHERE userid = ? AND idempotency_key = ? FOR UPDATE",
      [input.userid, input.idempotencyKey]
    );
    if (existing.length) {
      if (
        String(existing[0].cart_id) !== cartId ||
        Number(existing[0].cart_version) !== input.cartVersion ||
        String(existing[0].quote_id) !== input.quoteId
      )
        throw new OrderServiceError("IDEMPOTENCY_KEY_REUSED");
      if (existing[0].response_json) {
        await connection.commit();
        const stored = existing[0].response_json;
        return (typeof stored === "string" ? JSON.parse(stored) : stored) as AiOrderToolOutput;
      }
      const [groupRows] = await connection.query<RowDataPacket[]>(
        "SELECT order_group_id FROM order_groups WHERE order_group_id = ?",
        [existing[0].order_group_id]
      );
      const [orderRows] = await connection.query<RowDataPacket[]>(
        "SELECT order_id FROM orders WHERE order_group_id = ?",
        [existing[0].order_group_id]
      );
      await connection.commit();
      return {
        orderGroupId: String(groupRows[0].order_group_id),
        source: "AI",
        orders: orderRows.map((row) => ({ orderId: String(row.order_id) })),
        audit: { provenance: "assistant", userId: input.userid },
      };
    }
    const [userRows] = await connection.query<RowDataPacket[]>(
      "SELECT userid, is_authorized FROM users WHERE userid = ? FOR UPDATE",
      [input.userid]
    );
    if (!userRows.length) throw new OrderServiceError("UNAUTHENTICATED");
    if (!Boolean(userRows[0].is_authorized)) throw new OrderServiceError("AUTHORIZATION_REQUIRED");
    const [cartRows] = await connection.query<CartRow[]>(
      "SELECT cart_id, source, cart_version, expires_at FROM carts WHERE cart_id = ? AND userid = ? FOR UPDATE",
      [cartId, input.userid]
    );
    const cart = cartRows[0];
    if (!cart || cart.source !== "AI") throw new OrderServiceError("CART_SOURCE_MISMATCH");
    if (Number(cart.cart_version) !== input.cartVersion)
      throw new OrderServiceError("CART_CHANGED");
    if (!cart.expires_at || dateValue(cart.expires_at).getTime() <= Date.now())
      throw new OrderServiceError("CART_RESERVATION_EXPIRED");
    const [quoteRows] = await connection.query<QuoteRow[]>(
      "SELECT quote_id, cart_id, cart_version, subtotal_minor, total_minor, expires_at, consumed_at FROM cart_quotes WHERE quote_id = ? AND cart_id = ? FOR UPDATE",
      [input.quoteId, cartId]
    );
    const quote = quoteRows[0];
    if (
      !quote ||
      Number(quote.cart_version) !== input.cartVersion ||
      dateValue(quote.expires_at).getTime() <= Date.now()
    )
      throw new OrderServiceError("QUOTE_EXPIRED");
    if (quote.consumed_at) throw new OrderServiceError("QUOTE_ALREADY_USED");
    const [itemRows] = await connection.query<ItemRow[]>(
      "SELECT ci.sku_id, ci.allocated_quantity, ci.unavailable_quantity, s.product_id FROM cart_items ci INNER JOIN inventory_skus s ON s.sku_id = ci.sku_id WHERE ci.cart_id = ? AND ci.allocated_quantity > 0 ORDER BY ci.sku_id FOR UPDATE",
      [cartId]
    );
    if (!itemRows.length) throw new OrderServiceError("OUT_OF_STOCK");
    const products = await getCatalogProducts(itemRows.map((item) => item.product_id));
    for (const item of itemRows)
      if (!products.get(item.product_id))
        throw new OrderServiceError("PRICING_CATALOG_UNAVAILABLE");
    const currentSubtotalMinor = itemRows.reduce(
      (sum, item) =>
        sum + lineSubtotalMinor(products.get(item.product_id)!.price, Number(item.allocated_quantity)),
      0
    );
    if (currentSubtotalMinor !== Number(quote.subtotal_minor))
      throw new OrderServiceError("QUOTE_EXPIRED");
    await consumeReservedInventory(connection, cartId, itemRows, input.idempotencyKey);
    const orderGroupId = randomUUID();
    const orderId = randomUUID();
    await connection.execute(
      "INSERT INTO order_groups (order_group_id, userid, cart_id, cart_version, source, quote_id, idempotency_key) VALUES (?, ?, ?, ?, 'AI', ?, ?)",
      [orderGroupId, input.userid, cartId, input.cartVersion, input.quoteId, input.idempotencyKey]
    );
    await connection.execute("INSERT INTO orders (order_id, order_group_id) VALUES (?, ?)", [
      orderId,
      orderGroupId,
    ]);
    for (const item of itemRows)
      await connection.execute(
        "INSERT INTO order_items (order_id, sku_id, quantity, unit_price_minor) VALUES (?, ?, ?, ?)",
        [
          orderId,
          item.sku_id,
          item.allocated_quantity,
          toMinor(products.get(item.product_id)!.price),
        ]
      );
    const response: AiOrderToolOutput = {
      orderGroupId,
      source: "AI",
      orders: [{ orderId }],
      audit: { provenance: "assistant", userId: input.userid },
    };
    await connection.execute(
      "UPDATE cart_quotes SET consumed_at = CURRENT_TIMESTAMP(3) WHERE quote_id = ? AND consumed_at IS NULL",
      [input.quoteId]
    );
    await connection.execute("UPDATE order_groups SET response_json = ? WHERE order_group_id = ?", [
      JSON.stringify(response),
      orderGroupId,
    ]);
    await connection.execute(
      "INSERT INTO order_audit_events (event_id, order_group_id, event_type, provenance, details_json) VALUES (?, ?, 'ORDER_CREATED', 'assistant', ?)",
      [
        randomUUID(),
        orderGroupId,
        JSON.stringify({ userId: input.userid, cartId, quoteId: input.quoteId, source: "AI" }),
      ]
    );
    await connection.commit();
    return response;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
