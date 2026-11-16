import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db";

export const runtime = "nodejs";

type ExpiredReservation = RowDataPacket & {
  cart_id: string;
  sku_id: string;
  reserved_quantity: number;
};

function authorized(request: Request) {
  const secret = process.env.INVENTORY_CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  if (!process.env.INVENTORY_CRON_SECRET) {
    return NextResponse.json({ code: "EXPIRY_JOB_UNCONFIGURED" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  let releasedCount = 0;
  try {
    const pool = getDbPool();
    while (true) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [expiredRows] = await connection.query<ExpiredReservation[]>(
          "SELECT cart_id, sku_id, reserved_quantity FROM inventory_reservations WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP ORDER BY sku_id, cart_id LIMIT 500 FOR UPDATE"
        );
        for (const reservation of expiredRows) {
          const [inventoryUpdate] = await connection.execute<ResultSetHeader>(
            "UPDATE inventory_skus SET reserved = reserved - ? WHERE sku_id = ? AND reserved >= ?",
            [reservation.reserved_quantity, reservation.sku_id, reservation.reserved_quantity]
          );
          if (inventoryUpdate.affectedRows !== 1) throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");

          const [reservationUpdate] = await connection.execute<ResultSetHeader>(
            "UPDATE inventory_reservations SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE cart_id = ? AND sku_id = ? AND status = 'ACTIVE'",
            [reservation.cart_id, reservation.sku_id]
          );
          if (reservationUpdate.affectedRows !== 1) throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");

          await connection.execute(
            "INSERT INTO inventory_reservation_events (event_id, cart_id, sku_id, event_type, quantity, request_key) VALUES (?, ?, ?, 'EXPIRED', ?, NULL)",
            [randomUUID(), reservation.cart_id, reservation.sku_id, reservation.reserved_quantity]
          );
        }
        await connection.commit();
        releasedCount += expiredRows.length;
        if (expiredRows.length < 500) break;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    return NextResponse.json({ releasedCount, processedAt: new Date().toISOString() });
  } catch (error) {
    console.error("inventory expiry job failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ code: "INVENTORY_EXPIRY_UNAVAILABLE" }, { status: 503 });
  }
}
