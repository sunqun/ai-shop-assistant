import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth/auth-server";
import { confirmShoppingOrder } from "@/lib/agent/auto-shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmationSchema = z.object({
  cartVersion: z.number().int().positive(),
  quoteId: z.string().min(1).max(200),
  idempotencyKey: z.string().uuid(),
}).strict();

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后提交订单。", requestId: randomUUID() }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ code: "INVALID_JSON", message: "请求格式无效。", requestId: randomUUID() }, { status: 400 });
  }
  const parsed = confirmationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ code: "INVALID_ORDER_REQUEST", message: "订单确认信息无效，请重新获取报价。", requestId: randomUUID() }, { status: 400 });

  try {
    const order = await confirmShoppingOrder({ ...parsed.data, userid: session.userid });
    return NextResponse.json({ status: "ordered", message: "订单已提交。", order });
  } catch (error) {
    console.error("shopping order confirmation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ code: "ORDER_SUBMISSION_FAILED", message: error instanceof Error ? error.message : "订单暂时无法提交，请稍后重试。", requestId: randomUUID() }, { status: 409 });
  }
}
