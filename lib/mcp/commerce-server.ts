/**
 * 交易（Commerce）MCP 工具服务端。
 *
 * 对外暴露三个可被 AI Agent 调用的交易工具：
 *   - commerce.reconcile_cart：合并购物车并锁定库存（预占 24 小时）
 *   - commerce.quote_cart：基于购物车版本生成报价
 *   - commerce.submit_order：消费库存预留并创建订单
 *
 * 本层负责统一做入参校验、错误归一化，并转发到底层业务服务；
 * 不直接访问数据库，保证 MCP 边界与业务逻辑解耦。
 */
import { reconcileCart, CartServiceError } from "@/lib/repository/cart-service";
import { quoteCart, QuoteServiceError } from "@/lib/repository/quote-service";
import { submitAiOrder, OrderServiceError } from "@/lib/repository/order-service";
import { assertNotTaskQuote, ShoppingTaskError } from "@/lib/shop-task/shopping-task-store";
import type {
  CartToolOutput,
  OrderToolOutput,
  QuoteToolOutput,
  ReconcileCartToolInput,
  QuoteCartToolInput,
  SubmitOrderToolInput,
  McpToolCall,
  McpToolResult,
} from "@/lib/mcp/types";

// 交易工具所需的用户上下文：AI 购物车/报价/下单均需要已登录 userid。
export type CommerceToolContext = { userid?: string };

// UUID 格式（含版本位与变体位），用于校验 userid 与 quoteId。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 幂等键/请求键格式：允许字母数字及 . _ : -，长度 1~128。
const KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;

// 校验幂等键格式是否合法。
function validKey(value: unknown): value is string {
  return typeof value === "string" && KEY_RE.test(value);
}

// 校验购物车版本号：必须是 >= 1 的安全整数。
function validVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

// 校验合并购物车的 items 入参：数组（最多 100 项），每项含合法 id 与正整数 quantity。
function validItems(value: unknown): value is ReconcileCartToolInput["items"] {
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

// 校验 userid 是否为合法 UUID。
function validUserid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// 将底层抛出的业务错误归一化为 MCP 标准失败结构（{ ok: false, error }）。
// 非已知业务错误统一映射为 COMMERCE_SERVICE_UNAVAILABLE，并标记可重试。
function errorResult(error: unknown): {
  ok: false;
  error: { code: string; message: string; retryable?: boolean };
} {
  const code =
    error instanceof ShoppingTaskError ||
    error instanceof CartServiceError ||
    error instanceof QuoteServiceError ||
    error instanceof OrderServiceError
      ? error.code
      : "COMMERCE_SERVICE_UNAVAILABLE";
  // 业务错误码到用户可读中文提示的映射；未覆盖的错误码使用兜底文案。
  const messages: Record<string, string> = {
    TASK_CONFIRM_REQUIRED: "请通过当前购物任务确认订单。",
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

// 交易工具统一分发入口：校验工具名与入参，转发到底层服务，异常归一化为失败结果。
export async function callCommerceTool(
  call:
    | McpToolCall<"commerce.reconcile_cart">
    | McpToolCall<"commerce.quote_cart">
    | McpToolCall<"commerce.submit_order">,
  context: CommerceToolContext = {}
): Promise<McpToolResult<CartToolOutput | QuoteToolOutput | OrderToolOutput>> {
  try {
    // 仅接受已注册的交易工具名，其余一律视为工具不存在。
    if (
      !call ||
      typeof call !== "object" ||
      !["commerce.reconcile_cart", "commerce.quote_cart", "commerce.submit_order"].includes(
        call.name
      )
    ) {
      return { ok: false, error: { code: "MCP_TOOL_NOT_FOUND", message: "交易工具不存在。" } };
    }

    // 分支一：合并 AI 购物车（写入购物车并锁定库存 24 小时）。
    if (call.name === "commerce.reconcile_cart") {
      const input = call.arguments as ReconcileCartToolInput;
      if (!validUserid(context.userid))
        return { ok: false, error: { code: "UNAUTHENTICATED", message: "请先登录后再继续操作。" } };
      if (!input || !validItems(input.items) || !validKey(input.idempotencyKey)) {
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

    // 分支二：基于购物车版本生成报价（只读校验，不锁库存）。
    if (call.name === "commerce.quote_cart") {
      const input = call.arguments as QuoteCartToolInput;
      if (!validUserid(context.userid))
        return { ok: false, error: { code: "UNAUTHENTICATED", message: "请先登录后再继续操作。" } };
      if (!input || !validVersion(input.cartVersion)) {
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

    // 分支三：提交 AI 订单（消费库存预留并创建订单）。
    if (call.name === "commerce.submit_order") {
      const input = call.arguments as SubmitOrderToolInput;
      if (!validUserid(context.userid))
        return { ok: false, error: { code: "UNAUTHENTICATED", message: "请先登录后再提交订单。" } };
      if (
        !input ||
        !validVersion(input.cartVersion) ||
        !UUID_RE.test(input.quoteId) ||
        !validKey(input.idempotencyKey)
      ) {
        return { ok: false, error: { code: "MCP_INVALID_ARGUMENTS", message: "AI 下单参数无效。" } };
      }
      // 购物任务模式下必须通过任务确认下单，禁止绕过任务直接提交。
      await assertNotTaskQuote(context.userid, input.quoteId);
      return { ok: true, data: await submitAiOrder({ ...input, userid: context.userid }) };
    }

    // 兜底：未匹配任何已注册工具（正常情况下由上方白名单提前拦截，此处仅作安全收口）。
    return { ok: false, error: { code: "MCP_TOOL_NOT_FOUND", message: "交易工具不存在。" } };
  } catch (error) {
    console.error(
      "commerce MCP tool failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return errorResult(error);
  }
}
