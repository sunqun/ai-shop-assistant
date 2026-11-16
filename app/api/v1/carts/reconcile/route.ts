import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db";
import { allocateCartLines, normalizeCartLines, type StockBalance } from "@/lib/inventory-domain";
import { deriveCartId } from "@/lib/cart-session";

export const runtime = "nodejs";

type RequestItem = { id?: unknown; quantity?: unknown };
type InventoryRow = RowDataPacket & { sku_id: string; on_hand: number; reserved: number };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: randomUUID() }, { status });
}

export async function POST(request: Request) {
  let body: { cartToken?: unknown; items?: unknown; idempotencyKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(400, "INVALID_JSON", "请求格式无效。");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "INVALID_CART_REQUEST", "购物车请求无效。");
  }

  if (
    typeof body.cartToken !== "string" ||
    typeof body.idempotencyKey !== "string" ||
    body.idempotencyKey.length < 1 ||
    body.idempotencyKey.length > 128
  ) {
    return errorResponse(400, "INVALID_CART_REQUEST", "购物车凭证和幂等键不能为空。");
  }
  if (!Array.isArray(body.items)) {
    return errorResponse(400, "INVALID_CART_ITEMS", "购物车商品列表无效。");
  }

  let cartId: string;
  try {
    cartId = deriveCartId(body.cartToken);
  } catch {
    return errorResponse(400, "INVALID_CART_TOKEN", "购物车会话已失效，请刷新后重试。");
  }

  const rawItems = body.items;
  try {
    const lines = normalizeCartLines(
      rawItems.map((item: unknown) => {
        if (!item || typeof item !== "object") return { skuId: undefined, quantity: undefined };
        const requestItem = item as RequestItem;
        return { skuId: requestItem.id, quantity: requestItem.quantity };
      })
    );
    const payloadHash = createHash("sha256").update(JSON.stringify({ lines })).digest("hex");
    const connection = await getDbPool().getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute<RowDataPacket[]>(
        "SELECT response_json, payload_hash FROM cart_mutations WHERE cart_id = ? AND idempotency_key = ? FOR UPDATE",
        [cartId, body.idempotencyKey]
      );
      if (existing.length) {
        if (existing[0].payload_hash !== payloadHash) {
          await connection.rollback();
          return errorResponse(409, "IDEMPOTENCY_KEY_REUSED", "相同幂等键不能提交不同购物车内容。");
        }
        await connection.commit();
        return NextResponse.json(JSON.parse(existing[0].response_json as string));
      }

      await connection.execute(
        "INSERT INTO carts (cart_id, source, cart_version) VALUES (?, 'WEB', 0) ON DUPLICATE KEY UPDATE cart_id = cart_id",
        [cartId]
      );
      const [expiredReservations] = await connection.query<RowDataPacket[]>(
        "SELECT cart_id, sku_id, reserved_quantity FROM inventory_reservations WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP ORDER BY sku_id, cart_id FOR UPDATE"
      );
      for (const expired of expiredReservations) {
        const [inventoryUpdate] = await connection.execute<ResultSetHeader>(
          "UPDATE inventory_skus SET reserved = reserved - ? WHERE sku_id = ? AND reserved >= ?",
          [expired.reserved_quantity, expired.sku_id, expired.reserved_quantity]
        );
        if (inventoryUpdate.affectedRows !== 1) throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");
        const [reservationUpdate] = await connection.execute<ResultSetHeader>(
          "UPDATE inventory_reservations SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE cart_id = ? AND sku_id = ? AND status = 'ACTIVE'",
          [expired.cart_id, expired.sku_id]
        );
        if (reservationUpdate.affectedRows !== 1) throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");
        await connection.execute(
          "INSERT INTO inventory_reservation_events (event_id, cart_id, sku_id, event_type, quantity, request_key) VALUES (?, ?, ?, 'EXPIRED', ?, ?)",
          [randomUUID(), expired.cart_id, expired.sku_id, expired.reserved_quantity, body.idempotencyKey]
        );
      }
      const [previousReservations] = await connection.query<RowDataPacket[]>(
        "SELECT sku_id, reserved_quantity FROM inventory_reservations WHERE cart_id = ? AND status = 'ACTIVE' FOR UPDATE",
        [cartId]
      );
      for (const previous of previousReservations) {
        const [inventoryUpdate] = await connection.execute<ResultSetHeader>("UPDATE inventory_skus SET reserved = reserved - ? WHERE sku_id = ? AND reserved >= ?", [previous.reserved_quantity, previous.sku_id, previous.reserved_quantity]);
        if (inventoryUpdate.affectedRows !== 1) throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");
        await connection.execute(
          "INSERT INTO inventory_reservation_events (event_id, cart_id, sku_id, event_type, quantity, request_key) VALUES (?, ?, ?, 'RELEASED', ?, ?)",
          [randomUUID(), cartId, previous.sku_id, previous.reserved_quantity, body.idempotencyKey]
        );
      }
      await connection.execute("UPDATE inventory_reservations SET status = 'RELEASED', updated_at = CURRENT_TIMESTAMP WHERE cart_id = ? AND status = 'ACTIVE'", [cartId]);
      let rows: InventoryRow[] = [];
      if (lines.length) {
        const [inventoryRows] = await connection.query<InventoryRow[]>(
          "SELECT sku_id, on_hand, reserved FROM inventory_skus WHERE sku_id IN (?) ORDER BY sku_id FOR UPDATE",
          [lines.map((line) => line.skuId)]
        );
        rows = inventoryRows;
      }
      const balances = new Map<string, StockBalance>(rows.map((row) => [row.sku_id, { onHand: row.on_hand, reserved: row.reserved }]));
      const allocations = allocateCartLines(lines, balances);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const [cartRows] = await connection.execute<RowDataPacket[]>("SELECT cart_version FROM carts WHERE cart_id = ? FOR UPDATE", [cartId]);
      const cartVersion = Number(cartRows[0]?.cart_version ?? 0) + 1;

      await connection.execute("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);
      for (const allocation of allocations) {
        await connection.execute(
          "INSERT INTO cart_items (cart_id, sku_id, requested_quantity, allocated_quantity, unavailable_quantity) VALUES (?, ?, ?, ?, ?)",
          [cartId, allocation.skuId, allocation.quantity, allocation.allocatedQuantity, allocation.unavailableQuantity]
        );
        if (allocation.allocatedQuantity > 0) {
          await connection.execute("UPDATE inventory_skus SET reserved = reserved + ? WHERE sku_id = ?", [allocation.allocatedQuantity, allocation.skuId]);
          await connection.execute(
            "INSERT INTO inventory_reservations (cart_id, sku_id, reserved_quantity, status, expires_at) VALUES (?, ?, ?, 'ACTIVE', ?) ON DUPLICATE KEY UPDATE reserved_quantity = VALUES(reserved_quantity), status = 'ACTIVE', expires_at = VALUES(expires_at)",
            [cartId, allocation.skuId, allocation.allocatedQuantity, expiresAt]
          );
          await connection.execute(
            "INSERT INTO inventory_reservation_events (event_id, cart_id, sku_id, event_type, quantity, request_key) VALUES (?, ?, ?, 'RESERVED', ?, ?)",
            [randomUUID(), cartId, allocation.skuId, allocation.allocatedQuantity, body.idempotencyKey]
          );
        }
      }
      await connection.execute("UPDATE carts SET cart_version = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE cart_id = ?", [cartVersion, expiresAt, cartId]);
      const result = {
        cartId,
        cartVersion,
        expiresAt: expiresAt.toISOString(),
        split: allocations.some((item) => item.unavailableQuantity > 0),
        fullyOutOfStock: allocations.length > 0 && allocations.every((item) => item.allocatedQuantity === 0),
        allocations,
        quote: { status: "needs_human_review", code: "PRICING_RULES_PENDING" },
      };
      await connection.execute(
        "INSERT INTO cart_mutations (cart_id, idempotency_key, payload_hash, response_json) VALUES (?, ?, ?, ?)",
        [cartId, body.idempotencyKey, payloadHash, JSON.stringify(result)]
      );
      await connection.commit();
      return NextResponse.json(result);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CART_ITEMS") return errorResponse(400, error.message, "购物车商品或数量无效。");
    if (error instanceof Error && error.message === "INVENTORY_UNAVAILABLE") return errorResponse(409, error.message, "部分商品库存数据暂时不可用。");
    console.error("cart reconcile failed", error instanceof Error ? error.message : "unknown error");
    return errorResponse(503, "CART_SERVICE_UNAVAILABLE", "库存服务暂时无法使用，请稍后重试。");
  }
}

