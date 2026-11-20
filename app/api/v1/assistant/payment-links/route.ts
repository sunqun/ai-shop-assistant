import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/auth-server";
import { listPaymentLinks, PaymentLinkError } from "@/lib/payment-link/payment-link-service";
import { callCreatePaymentLinkTool } from "@/lib/mcp/tool-calls";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: randomUUID() }, { status });
}

function mapError(error: unknown) {
  const code = error instanceof PaymentLinkError ? error.code : "PAYMENT_LINK_UNAVAILABLE";
  const status = code === "UNAUTHENTICATED" ? 401 : code === "PAYMENT_LINK_NOT_FOUND" ? 404 : 400;
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "请先登录后生成支付短链。",
    INVALID_PAYMENT_LINK_REQUEST: "支付短链参数无效。",
    PRODUCT_NOT_FOUND: "商品不存在。",
    PAYMENT_LINK_NOT_FOUND: "支付短链不存在或已删除。",
  };
  return errorResponse(status, code, messages[code] ?? "支付短链服务暂时无法使用，请稍后重试。");
}

export async function GET() {
  const session = await readSession();
  if (!session) return errorResponse(401, "UNAUTHENTICATED", "请先登录后查看支付短链。");
  try {
    return NextResponse.json({ links: await listPaymentLinks(session.userid) });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return errorResponse(401, "UNAUTHENTICATED", "请先登录后生成支付短链。");
  let body: { productId?: unknown; quantity?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(400, "INVALID_JSON", "请求格式无效。");
  }
  try {
    if (!body || typeof body.productId !== "string" || !Number.isSafeInteger(body.quantity))
      throw new PaymentLinkError("INVALID_PAYMENT_LINK_REQUEST");
    const result = await callCreatePaymentLinkTool(
      { productId: body.productId, quantity: body.quantity as number },
      { userid: session.userid }
    );
    if (!result.ok) {
      const status = result.error.code === "UNAUTHENTICATED" ? 401 : result.error.retryable ? 503 : 400;
      return errorResponse(status, result.error.code, result.error.message);
    }
    return NextResponse.json({ link: result.data }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}
