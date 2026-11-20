import { createHash, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/repository/db";
import { allocateCartLines, normalizeCartLines, type StockBalance } from "@/lib/inventory-domain";
import { deriveUserCartId } from "@/lib/repository/cart-session";

export type CartSource = "WEB" | "AI";
export type CartMutationItem = { id?: unknown; quantity?: unknown };
export type ReconcileCartInput = {
  userid: string;
  items: CartMutationItem[];
  idempotencyKey: string;
  source: CartSource;
};

export type UserCartItem = {
  skuId: string;
  productId: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  unavailableQuantity: number;
};

export type UserCartView = {
  cartId: string;
  source: CartSource;
  cartVersion: number;
  expiresAt: string | null;
  items: UserCartItem[];
};

export type ReconcileCartResult = {
  cartId: string;
  source: CartSource;
  cartVersion: number;
  expiresAt: string;
  split: boolean;
  fullyOutOfStock: boolean;
  allocations: Array<{
    skuId: string;
    quantity: number;
    allocatedQuantity: number;
    unavailableQuantity: number;
  }>;
  quote: { status: "needs_requote"; code: "QUOTE_REQUIRED" };
};

type InventoryRow = RowDataPacket & { sku_id: string; on_hand: number; reserved: number };

export class CartServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

// 合并购物车
export async function reconcileCart(input: ReconcileCartInput): Promise<ReconcileCartResult> {
  let cartId: string;
  try {
    cartId = deriveUserCartId(input.userid, input.source);
  } catch {
    throw new CartServiceError("CART_SESSION_UNAVAILABLE");
  }

  let lines: ReturnType<typeof normalizeCartLines>;
  try {
    lines = normalizeCartLines(
      input.items.map((item) => ({
        skuId: item && typeof item === "object" ? item.id : undefined,
        quantity: item && typeof item === "object" ? item.quantity : undefined,
      }))
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CART_ITEMS")
      throw new CartServiceError("INVALID_CART_ITEMS");
    throw error;
  }
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ source: input.source, lines }))
    .digest("hex");
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<RowDataPacket[]>(
      "SELECT response_json, payload_hash FROM cart_mutations WHERE cart_id = ? AND idempotency_key = ? FOR UPDATE",
      [cartId, input.idempotencyKey]
    );
    if (existing.length) {
      if (existing[0].payload_hash !== payloadHash)
        throw new CartServiceError("IDEMPOTENCY_KEY_REUSED");
      await connection.commit();
      return JSON.parse(existing[0].response_json as string) as ReconcileCartResult;
    }

    await connection.execute(
      "INSERT INTO carts (cart_id, userid, source, cart_version) VALUES (?, ?, ?, 0) ON DUPLICATE KEY UPDATE userid = COALESCE(userid, VALUES(userid)), source = VALUES(source)",
      [cartId, input.userid, input.source]
    );
    const [ownerRows] = await connection.execute<RowDataPacket[]>(
      "SELECT userid, source FROM carts WHERE cart_id = ? FOR UPDATE",
      [cartId]
    );
    if (!ownerRows.length || ownerRows[0].userid !== input.userid)
      throw new CartServiceError("CART_OWNER_MISMATCH");
    if (ownerRows[0].source !== input.source) throw new CartServiceError("CART_SOURCE_MISMATCH");
    const [expiredReservations] = await connection.query<RowDataPacket[]>(
      "SELECT cart_id, sku_id, reserved_quantity FROM inventory_reservations WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP ORDER BY sku_id, cart_id FOR UPDATE"
    );
    for (const expired of expiredReservations) {
      const [inventoryUpdate] = await connection.execute<ResultSetHeader>(
        "UPDATE inventory_skus SET reserved = reserved - ? WHERE sku_id = ? AND reserved >= ?",
        [expired.reserved_quantity, expired.sku_id, expired.reserved_quantity]
      );
      if (inventoryUpdate.affectedRows !== 1)
        throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");
      const [reservationUpdate] = await connection.execute<ResultSetHeader>(
        "UPDATE inventory_reservations SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE cart_id = ? AND sku_id = ? AND status = 'ACTIVE'",
        [expired.cart_id, expired.sku_id]
      );
      if (reservationUpdate.affectedRows !== 1)
        throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");
      await connection.execute(
        "INSERT INTO inventory_reservation_events (event_id, cart_id, sku_id, event_type, quantity, request_key) VALUES (?, ?, ?, 'EXPIRED', ?, ?)",
        [
          randomUUID(),
          expired.cart_id,
          expired.sku_id,
          expired.reserved_quantity,
          input.idempotencyKey,
        ]
      );
    }

    const [previousReservations] = await connection.query<RowDataPacket[]>(
      "SELECT sku_id, reserved_quantity FROM inventory_reservations WHERE cart_id = ? AND status = 'ACTIVE' FOR UPDATE",
      [cartId]
    );
    for (const previous of previousReservations) {
      const [inventoryUpdate] = await connection.execute<ResultSetHeader>(
        "UPDATE inventory_skus SET reserved = reserved - ? WHERE sku_id = ? AND reserved >= ?",
        [previous.reserved_quantity, previous.sku_id, previous.reserved_quantity]
      );
      if (inventoryUpdate.affectedRows !== 1)
        throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");
      await connection.execute(
        "INSERT INTO inventory_reservation_events (event_id, cart_id, sku_id, event_type, quantity, request_key) VALUES (?, ?, ?, 'RELEASED', ?, ?)",
        [randomUUID(), cartId, previous.sku_id, previous.reserved_quantity, input.idempotencyKey]
      );
    }
    await connection.execute(
      "UPDATE inventory_reservations SET status = 'RELEASED', updated_at = CURRENT_TIMESTAMP WHERE cart_id = ? AND status = 'ACTIVE'",
      [cartId]
    );

    let rows: InventoryRow[] = [];
    if (lines.length) {
      const [inventoryRows] = await connection.query<InventoryRow[]>(
        "SELECT sku_id, on_hand, reserved FROM inventory_skus WHERE sku_id IN (?) ORDER BY sku_id FOR UPDATE",
        [lines.map((line) => line.skuId)]
      );
      rows = inventoryRows;
    }
    const balances = new Map<string, StockBalance>(
      rows.map((row) => [row.sku_id, { onHand: row.on_hand, reserved: row.reserved }])
    );
    const allocations = allocateCartLines(lines, balances);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [cartRows] = await connection.execute<RowDataPacket[]>(
      "SELECT cart_version FROM carts WHERE cart_id = ? FOR UPDATE",
      [cartId]
    );
    const cartVersion = Number(cartRows[0]?.cart_version ?? 0) + 1;

    await connection.execute("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);
    for (const allocation of allocations) {
      await connection.execute(
        "INSERT INTO cart_items (cart_id, sku_id, requested_quantity, allocated_quantity, unavailable_quantity) VALUES (?, ?, ?, ?, ?)",
        [
          cartId,
          allocation.skuId,
          allocation.quantity,
          allocation.allocatedQuantity,
          allocation.unavailableQuantity,
        ]
      );
      if (allocation.allocatedQuantity > 0) {
        await connection.execute(
          "UPDATE inventory_skus SET reserved = reserved + ? WHERE sku_id = ?",
          [allocation.allocatedQuantity, allocation.skuId]
        );
        await connection.execute(
          "INSERT INTO inventory_reservations (cart_id, sku_id, reserved_quantity, status, expires_at) VALUES (?, ?, ?, 'ACTIVE', ?) ON DUPLICATE KEY UPDATE reserved_quantity = VALUES(reserved_quantity), status = 'ACTIVE', expires_at = VALUES(expires_at)",
          [cartId, allocation.skuId, allocation.allocatedQuantity, expiresAt]
        );
        await connection.execute(
          "INSERT INTO inventory_reservation_events (event_id, cart_id, sku_id, event_type, quantity, request_key) VALUES (?, ?, ?, 'RESERVED', ?, ?)",
          [
            randomUUID(),
            cartId,
            allocation.skuId,
            allocation.allocatedQuantity,
            input.idempotencyKey,
          ]
        );
      }
    }
    await connection.execute(
      "UPDATE carts SET source = ?, cart_version = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE cart_id = ?",
      [input.source, cartVersion, expiresAt, cartId]
    );

    const result: ReconcileCartResult = {
      cartId,
      source: input.source,
      cartVersion,
      expiresAt: expiresAt.toISOString(),
      split: allocations.some((item) => item.unavailableQuantity > 0),
      fullyOutOfStock:
        allocations.length > 0 && allocations.every((item) => item.allocatedQuantity === 0),
      allocations,
      quote: { status: "needs_requote", code: "QUOTE_REQUIRED" },
    };
    await connection.execute(
      "INSERT INTO cart_mutations (cart_id, idempotency_key, payload_hash, response_json) VALUES (?, ?, ?, ?)",
      [cartId, input.idempotencyKey, payloadHash, JSON.stringify(result)]
    );
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// 获取用户购物车
export async function getUserCart(userid: string, source: CartSource): Promise<UserCartView> {
  const cartId = deriveUserCartId(userid, source);
  const connection = await getDbPool().getConnection();
  try {
    const [cartRows] = await connection.query<RowDataPacket[]>(
      "SELECT cart_id, source, cart_version, expires_at FROM carts WHERE cart_id = ? AND userid = ?",
      [cartId, userid]
    );
    const cart = cartRows[0];
    if (!cart) {
      return { cartId, source, cartVersion: 0, expiresAt: null, items: [] };
    }
    const [itemRows] = await connection.query<
      (RowDataPacket & {
        sku_id: string;
        product_id: string;
        requested_quantity: number;
        allocated_quantity: number;
        unavailable_quantity: number;
      })[]
    >(
      "SELECT ci.sku_id, s.product_id, ci.requested_quantity, ci.allocated_quantity, ci.unavailable_quantity FROM cart_items ci INNER JOIN inventory_skus s ON s.sku_id = ci.sku_id WHERE ci.cart_id = ? ORDER BY ci.sku_id",
      [cartId]
    );
    return {
      cartId,
      source: cart.source,
      cartVersion: Number(cart.cart_version),
      expiresAt:
        cart.expires_at instanceof Date
          ? cart.expires_at.toISOString()
          : cart.expires_at
            ? String(cart.expires_at)
            : null,
      items: itemRows.map((row) => ({
        skuId: String(row.sku_id),
        productId: String(row.product_id),
        requestedQuantity: Number(row.requested_quantity),
        allocatedQuantity: Number(row.allocated_quantity),
        unavailableQuantity: Number(row.unavailable_quantity),
      })),
    };
  } finally {
    connection.release();
  }
}
