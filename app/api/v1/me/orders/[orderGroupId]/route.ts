import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/auth-server";
import { getUserOrder } from "@/lib/repository/order-service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ orderGroupId: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后查看订单。", requestId: randomUUID() }, { status: 401 });
  const { orderGroupId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderGroupId)) return NextResponse.json({ code: "ORDER_NOT_FOUND", message: "订单不存在。", requestId: randomUUID() }, { status: 404 });
  try {
    const order = await getUserOrder(session.userid, orderGroupId);
    if (!order) return NextResponse.json({ code: "ORDER_NOT_FOUND", message: "订单不存在。", requestId: randomUUID() }, { status: 404 });
    return NextResponse.json({ order }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("user order query failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ code: "ORDERS_UNAVAILABLE", message: "订单暂时无法读取，请稍后重试。", requestId: randomUUID() }, { status: 503 });
  }
}
