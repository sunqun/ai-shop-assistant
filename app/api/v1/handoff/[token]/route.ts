import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPaymentLink, PaymentLinkError, submitPaymentLinkOrder } from "@/lib/payment-link-service";

export const runtime = "nodejs";

function failure(error: unknown) {
  const code = error instanceof PaymentLinkError ? error.code : "PAYMENT_LINK_UNAVAILABLE";
  const requestId = randomUUID();
  const statuses: Record<string, number> = { PAYMENT_LINK_NOT_FOUND: 404, OUT_OF_STOCK: 409, INVALID_PAYMENT_LINK_ORDER: 400, PAYMENT_LINK_UNAVAILABLE: 503 };
  const messages: Record<string, string> = { PAYMENT_LINK_NOT_FOUND: "支付短链不存在或已删除。", OUT_OF_STOCK: "当前商品暂时无库存，请稍后重试。", INVALID_PAYMENT_LINK_ORDER: "请输入支付密码后再下单。" };
  if (code === "PAYMENT_LINK_UNAVAILABLE") console.error("payment handoff request failed", { requestId, error });
  return NextResponse.json({ code, message: messages[code] ?? "支付短链服务暂时无法使用，请稍后重试。", requestId }, { status: statuses[code] ?? 400 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try { const { token } = await params; const result = await getPaymentLink(token); return NextResponse.json({ link: result.view }); } catch (error) { return failure(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  let body: { paymentPassword?: unknown; idempotencyKey?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ code: "INVALID_JSON", message: "请求格式无效。", requestId: randomUUID() }, { status: 400 }); }
  try {
    const { token } = await params;
    if (!body || typeof body.paymentPassword !== "string" || typeof body.idempotencyKey !== "string") throw new PaymentLinkError("INVALID_PAYMENT_LINK_ORDER");
    return NextResponse.json(await submitPaymentLinkOrder({ token, paymentPassword: body.paymentPassword, idempotencyKey: body.idempotencyKey }));
  } catch (error) { return failure(error); }
}
