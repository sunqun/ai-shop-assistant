import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/auth-server";
import { getUserCart } from "@/lib/cart-service/cart-service";

export const runtime = "nodejs";

export async function GET() {
  const session = await readSession();
  if (!session)
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "请先登录后再查看购物车。", requestId: randomUUID() },
      { status: 401 }
    );
  try {
    return NextResponse.json(await getUserCart(session.userid, "WEB"));
  } catch (error) {
    console.error("cart read failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { code: "CART_SERVICE_UNAVAILABLE", message: "购物车服务暂时无法使用，请稍后重试。", requestId: randomUUID() },
      { status: 503 }
    );
  }
}
