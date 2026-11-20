/**
 * MCP 工具的最小领域契约。
 *
 * 这里使用进程内传输，保持与未来独立 MCP Server 的 JSON-RPC/HTTP 传输
 * 兼容：调用方只依赖工具名、参数和结构化结果，不依赖数据库实现。
 */
export type McpToolName = "catalog.search_products" | "commerce.reconcile_cart" | "commerce.quote_cart" | "commerce.submit_order" | "commerce.create_payment_link";

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
    : TName extends "commerce.reconcile_cart"
      ? ReconcileCartToolInput
      : TName extends "commerce.quote_cart"
        ? QuoteCartToolInput
      : TName extends "commerce.submit_order"
        ? SubmitOrderToolInput
        : CreatePaymentLinkToolInput;
};

export type CatalogSearchToolInput = {
  intent: import("@/lib/catalog").ProductSearchIntent;
  pageSize: number;
  cursor?: string;
};

export type CatalogSearchToolOutput = import("@/lib/catalog").ProductSearchPage;

export type AiCartItemInput = { id: string; quantity: number };
export type ReconcileCartToolInput = {
  items: AiCartItemInput[];
  idempotencyKey: string;
};
export type QuoteCartToolInput = { cartVersion: number };
export type SubmitOrderToolInput = {
  cartVersion: number;
  quoteId: string;
  idempotencyKey: string;
};
export type CreatePaymentLinkToolInput = { productId: string; quantity: number };
export type CreatePaymentLinkToolOutput = import("@/lib/payment-link/payment-link-service").PaymentLinkView;
export type CartToolOutput = import("@/lib/cart-service/cart-service").ReconcileCartResult;
export type QuoteToolOutput = {
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
export type OrderToolOutput = {
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

