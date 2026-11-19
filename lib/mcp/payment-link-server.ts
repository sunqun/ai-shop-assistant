import { createPaymentLink, PaymentLinkError } from "@/lib/payment-link/payment-link-service";
import type {
  CreatePaymentLinkToolInput,
  CreatePaymentLinkToolOutput,
  McpToolCall,
  McpToolResult,
} from "@/lib/mcp/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function callPaymentLinkTool(
  call: McpToolCall<"commerce.create_payment_link">,
  context: { userid?: string } = {}
): Promise<McpToolResult<CreatePaymentLinkToolOutput>> {
  if (call?.name !== "commerce.create_payment_link") {
    return { ok: false, error: { code: "MCP_TOOL_NOT_FOUND", message: "支付短链工具不存在。" } };
  }
  if (!context.userid || !UUID_RE.test(context.userid)) {
    return { ok: false, error: { code: "UNAUTHENTICATED", message: "请先登录后生成支付短链。" } };
  }
  const input = call.arguments as CreatePaymentLinkToolInput;
  if (
    !input ||
    typeof input.productId !== "string" ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(input.productId) ||
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 99
  ) {
    return { ok: false, error: { code: "MCP_INVALID_ARGUMENTS", message: "支付短链参数无效。" } };
  }
  try {
    return { ok: true, data: await createPaymentLink({ ...input, userid: context.userid }) };
  } catch (error) {
    const code = error instanceof PaymentLinkError ? error.code : "PAYMENT_LINK_UNAVAILABLE";
    return {
      ok: false,
      error: {
        code,
        message:
          code === "PRODUCT_NOT_FOUND" ? "商品不存在。" : "支付短链服务暂时无法使用，请稍后重试。",
        retryable: code === "PAYMENT_LINK_UNAVAILABLE",
      },
    };
  }
}
