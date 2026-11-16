import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth-server";
import { listUserOrders } from "@/lib/order-service";

export const runtime = "nodejs";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后查看订单。", requestId: randomUUID() }, { status: 401 });
  try {
    return NextResponse.json({ orders: await listUserOrders(session.userid) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("user orders query failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ code: "ORDERS_UNAVAILABLE", message: "订单列表暂时无法读取，请稍后重试。", requestId: randomUUID() }, { status: 503 });
  }
}
