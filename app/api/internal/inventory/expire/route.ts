/**
 * 库存预占过期清理定时任务（内部接口）。
 *
 * 购物车下单后会为 SKU 预留库存（inventory_reservations），并设置过期时间。
 * 本接口由 cron 定时触发，负责把已过期但仍处于 ACTIVE 状态的预占记录释放掉：
 *   1. 校验内部任务密钥（INVENTORY_CRON_SECRET），仅允许授权调用；
 *   2. 分批（每批 500 条）用行锁查询已过期预占记录；
 *   3. 在事务内依次：扣减 SKU 的已预占数量、把预占记录标记为 EXPIRED、写入 EXPIRED 事件；
 *   4. 循环处理直到某批数量不足 500（表示已清空），返回本次释放的总条数。
 */
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

// 校验调用方是否持有正确的 Bearer token（使用 timingSafeEqual 避免时序侧信道攻击）
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
    // 分批处理，避免单次事务锁定/写入过多记录导致长事务
    while (true) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        // FOR UPDATE 锁定这批已过期记录，防止与其它释放/确认流程并发冲突
        const [expiredRows] = await connection.query<ExpiredReservation[]>(
          "SELECT cart_id, sku_id, reserved_quantity FROM inventory_reservations WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP ORDER BY sku_id, cart_id LIMIT 500 FOR UPDATE"
        );
        for (const reservation of expiredRows) {
          // 回退 SKU 的已预占数量；reserved >= ? 作为兜底，避免扣成负数（超卖/数据不一致）
          const [inventoryUpdate] = await connection.execute<ResultSetHeader>(
            "UPDATE inventory_skus SET reserved = reserved - ? WHERE sku_id = ? AND reserved >= ?",
            [reservation.reserved_quantity, reservation.sku_id, reservation.reserved_quantity]
          );
          // affectedRows 必须为 1，否则说明预占数与库存扣减数不一致，直接回滚整个事务
          if (inventoryUpdate.affectedRows !== 1) throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");

          const [reservationUpdate] = await connection.execute<ResultSetHeader>(
            "UPDATE inventory_reservations SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE cart_id = ? AND sku_id = ? AND status = 'ACTIVE'",
            [reservation.cart_id, reservation.sku_id]
          );
          if (reservationUpdate.affectedRows !== 1) throw new Error("INVENTORY_RESERVATION_INVARIANT_FAILED");

          // 记录一条过期事件，便于审计与后续对账
          await connection.execute(
            "INSERT INTO inventory_reservation_events (event_id, cart_id, sku_id, event_type, quantity, request_key) VALUES (?, ?, ?, 'EXPIRED', ?, NULL)",
            [randomUUID(), reservation.cart_id, reservation.sku_id, reservation.reserved_quantity]
          );
        }
        await connection.commit();
        releasedCount += expiredRows.length;
        // 本批不足 500 说明已无更多过期记录，退出循环
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
