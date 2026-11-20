import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/auth-server";
import { deletePaymentLink, PaymentLinkError } from "@/lib/repository/payment-link-service";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ linkId: string }> }
) {
  const session = await readSession();
  if (!session)
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "请先登录后删除支付短链。", requestId: randomUUID() },
      { status: 401 }
    );
  try {
    const { linkId } = await params;
    await deletePaymentLink(session.userid, linkId);
    return new Response(null, { status: 204 });
  } catch (error) {
    const code = error instanceof PaymentLinkError ? error.code : "PAYMENT_LINK_UNAVAILABLE";
    return NextResponse.json(
      {
        code,
        message:
          code === "PAYMENT_LINK_NOT_FOUND"
            ? "支付短链不存在或已删除。"
            : "支付短链服务暂时无法使用，请稍后重试。",
        requestId: randomUUID(),
      },
      { status: code === "PAYMENT_LINK_NOT_FOUND" ? 404 : 400 }
    );
  }
}
