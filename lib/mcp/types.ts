/**
 * MCP 工具的最小领域契约。
 *
 * 这里使用进程内传输，保持与未来独立 MCP Server 的 JSON-RPC/HTTP 传输
 * 兼容：调用方只依赖工具名、参数和结构化结果，不依赖数据库实现。
 */
export type McpToolName = "catalog.search_products" | "commerce.ai_reconcile_cart" | "commerce.ai_quote_cart" | "commerce.ai_submit_order";

export type McpError = {
  code: string;
  message: string;
  retryable?: boolean;
};

export type McpToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: McpError };

export type McpToolCall<TName extends McpToolName = McpToolName> = {
  name: TName;
  arguments: TName extends "catalog.search_products"
    ? CatalogSearchToolInput
    : TName extends "commerce.ai_reconcile_cart"
      ? AiReconcileCartToolInput
      : TName extends "commerce.ai_quote_cart"
        ? AiQuoteCartToolInput
        : AiSubmitOrderToolInput;
};

export type CatalogSearchToolInput = {
  intent: import("@/lib/catalog").ProductSearchIntent;
  pageSize: number;
  cursor?: string;
};

export type CatalogSearchToolOutput = import("@/lib/catalog").ProductSearchPage;

export type AiCartItemInput = { id: string; quantity: number };
export type AiReconcileCartToolInput = {
  items: AiCartItemInput[];
  idempotencyKey: string;
};
export type AiQuoteCartToolInput = { cartVersion: number };
export type AiSubmitOrderToolInput = {
  cartVersion: number;
  quoteId: string;
  idempotencyKey: string;
};
export type AiCartToolOutput = import("@/lib/cart-service/cart-service").ReconcileCartResult;
export type AiQuoteToolOutput = {
  quote: {
    quoteId: string;
    cartId: string;
    cartVersion: number;
    currency: "TWD";
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    totalDueMinor: number;
    promotion: string;
    label: string;
    ruleVersion: string;
    expiresAt: string;
  };
  appliedRules: string[];
};
export type AiOrderToolOutput = {
  orderGroupId: string;
  source: "AI";
  orders: Array<{ orderId: string }>;
  audit: { provenance: "assistant"; userId: string };
};

export type WebOrderToolOutput = {
  orderGroupId: string;
  source: "WEB";
  orders: Array<{ orderId: string }>;
  audit: { provenance: "web"; userId: string };
};

