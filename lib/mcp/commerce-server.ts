import { reconcileCart, CartServiceError } from "@/lib/cart-service";
import { quoteCart, QuoteServiceError } from "@/lib/quote-service";
import { submitAiOrder, OrderServiceError } from "@/lib/order-service";
import type {
  AiCartToolOutput,
  AiOrderToolOutput,
  AiQuoteToolOutput,
  AiReconcileCartToolInput,
  AiQuoteCartToolInput,
  AiSubmitOrderToolInput,
  McpToolCall,
  McpToolResult,
} from "@/lib/mcp/types";

export type CommerceToolContext = { userid?: string };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
function validKey(value: unknown): value is string {
  return typeof value === "string" && KEY_RE.test(value);
}
function validToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}
function validVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}
function validItems(value: unknown): value is AiReconcileCartToolInput["items"] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string" &&
        /^[A-Za-z0-9._-]{1,100}$/.test((item as { id: string }).id) &&
        Number.isSafeInteger((item as { quantity?: unknown }).quantity) &&
        (item as { quantity: number }).quantity >= 1 &&
        (item as { quantity: number }).quantity <= 2147483647
    )
  );
}
function validUserid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function errorResult(error: unknown): {
  ok: false;
  error: { code: string; message: string; retryable?: boolean };
} {
  const code =
    error instanceof CartServiceError ||
    error instanceof QuoteServiceError ||
    error instanceof OrderServiceError
      ? error.code
      : "COMMERCE_SERVICE_UNAVAILABLE";
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "请先登录后再提交订单。",
    AUTHORIZATION_REQUIRED: "请先完成 AI 自助下单授权。",
    CART_SOURCE_MISMATCH: "购物车来源无效。",
    CART_CHANGED: "购物车内容已变化，请重新校验库存并报价。",
    CART_RESERVATION_EXPIRED: "库存锁定已过期，请重新校验库存。",
    QUOTE_EXPIRED: "报价已过期，请重新报价。",
    QUOTE_ALREADY_USED: "报价已用于下单，请重新报价。",
    PRICING_CATALOG_UNAVAILABLE: "商品价格暂时无法确认，请稍后重试。",
    OUT_OF_STOCK: "购物车中没有可下单的有货商品，库存可能已被其他订单占用。",
    INVALID_CART_TOKEN: "购物车会话已失效，请刷新后重试。",
    CART_SESSION_UNAVAILABLE: "购物车服务配置暂不可用，请稍后重试。",
    IDEMPOTENCY_KEY_REUSED: "相同幂等键不能提交不同内容。",
    CART_OWNER_MISMATCH: "购物车不属于当前登录用户。",
  };
  return {
    ok: false,
    error: {
      code,
      message: messages[code] ?? "交易服务暂时无法使用，请稍后重试。",
      retryable:
        code === "COMMERCE_SERVICE_UNAVAILABLE" ||
        code === "CART_SESSION_UNAVAILABLE" ||
        code === "PRICING_CATALOG_UNAVAILABLE",
    },
  };
}

export async function callCommerceTool(
  call:
    | McpToolCall<"commerce.ai_reconcile_cart">
    | McpToolCall<"commerce.ai_quote_cart">
    | McpToolCall<"commerce.ai_submit_order">,
  context: CommerceToolContext = {}
): Promise<McpToolResult<AiCartToolOutput | AiQuoteToolOutput | AiOrderToolOutput>> {
  try {
    if (
      !call ||
      typeof call !== "object" ||
      ![
        "commerce.ai_reconcile_cart",
        "commerce.ai_quote_cart",
        "commerce.ai_submit_order",
      ].includes(call.name)
    ) {
      return { ok: false, error: { code: "MCP_TOOL_NOT_FOUND", message: "交易工具不存在。" } };
    }
    if (call.name === "commerce.ai_reconcile_cart") {
      const input = call.arguments as AiReconcileCartToolInput;
      if (!validUserid(context.userid))
        return { ok: false, error: { code: "UNAUTHENTICATED", message: "请先登录后再继续操作。" } };
      if (
        !input ||
        !validToken(input.cartToken) ||
        !validItems(input.items) ||
        !validKey(input.idempotencyKey)
      ) {
        return {
          ok: false,
          error: { code: "MCP_INVALID_ARGUMENTS", message: "AI 购物车参数无效。" },
        };
      }
      return {
        ok: true,
        data: await reconcileCart({ ...input, userid: context.userid, source: "AI" }),
      };
    }
    if (call.name === "commerce.ai_quote_cart") {
      const input = call.arguments as AiQuoteCartToolInput;
      if (!validUserid(context.userid))
        return { ok: false, error: { code: "UNAUTHENTICATED", message: "请先登录后再继续操作。" } };
      if (!input || !validToken(input.cartToken) || !validVersion(input.cartVersion)) {
        return {
          ok: false,
          error: { code: "MCP_INVALID_ARGUMENTS", message: "AI 报价参数无效。" },
        };
      }
      return {
        ok: true,
        data: await quoteCart({ ...input, userid: context.userid, expectedSource: "AI" }),
      };
    }
    const input = call.arguments as AiSubmitOrderToolInput;
    if (!validUserid(context.userid))
      return { ok: false, error: { code: "UNAUTHENTICATED", message: "请先登录后再提交订单。" } };
    if (
      !input ||
      !validToken(input.cartToken) ||
      !validVersion(input.cartVersion) ||
      !UUID_RE.test(input.quoteId) ||
      !validKey(input.idempotencyKey)
    ) {
      return { ok: false, error: { code: "MCP_INVALID_ARGUMENTS", message: "AI 下单参数无效。" } };
    }
    return { ok: true, data: await submitAiOrder({ ...input, userid: context.userid }) };
  } catch (error) {
    console.error(
      "commerce MCP tool failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return errorResult(error);
  }
}
