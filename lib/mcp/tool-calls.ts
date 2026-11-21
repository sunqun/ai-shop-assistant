import { callCatalogTool, callProductReviewsTool } from "@/lib/mcp/catalog-server";
import type { ProductReviewsToolInput, ProductReviewsToolOutput } from "./types";
import { callCommerceTool, type CommerceToolContext } from "@/lib/mcp/commerce-server";
import { callPaymentLinkTool } from "@/lib/mcp/payment-link-server";
import type {
  CartToolOutput,
  OrderToolOutput,
  QuoteCartToolInput,
  QuoteToolOutput,
  ReconcileCartToolInput,
  SubmitOrderToolInput,
  CatalogSearchToolInput,
  CatalogSearchToolOutput,
  CreatePaymentLinkToolInput,
  CreatePaymentLinkToolOutput,
  McpToolResult,
} from "@/lib/mcp/types";

/**
 * MCP Client 负责屏蔽传输方式。
 * 当前调用同进程 Server，未来可替换为远程 MCP JSON-RPC 调用而不改 Agent。
 */
// 商品目录检索：无需用户上下文，直接转发到 catalog server。
export async function callCatalogSearchTool(
  input: CatalogSearchToolInput
): Promise<McpToolResult<CatalogSearchToolOutput>> {
  return callCatalogTool({ name: "catalog.search_products", arguments: input });
}

export async function callReadProductReviewsTool(
  input: ProductReviewsToolInput
): Promise<McpToolResult<ProductReviewsToolOutput>> {
  return callProductReviewsTool({ name: "catalog.read_product_reviews", arguments: input });
}

// AI 合并购物车：携带用户上下文，把冲突/多来源的购物车项合并为一致状态。
export async function callAiReconcileCartTool(
  input: ReconcileCartToolInput,
  context: CommerceToolContext
): Promise<McpToolResult<CartToolOutput>> {
  return callCommerceTool(
    { name: "commerce.reconcile_cart", arguments: input },
    context
  ) as Promise<McpToolResult<CartToolOutput>>;
}

// AI 报价购物车：基于当前购物车版本生成报价预览。
export async function callAiQuoteCartTool(
  input: QuoteCartToolInput,
  context: CommerceToolContext
): Promise<McpToolResult<QuoteToolOutput>> {
  return callCommerceTool({ name: "commerce.quote_cart", arguments: input }, context) as Promise<
    McpToolResult<QuoteToolOutput>
  >;
}

// AI 提交订单：按购物车版本 + 报价 ID 正式下单。
export async function callAiSubmitOrderTool(
  input: SubmitOrderToolInput,
  context: CommerceToolContext
): Promise<McpToolResult<OrderToolOutput>> {
  return callCommerceTool({ name: "commerce.submit_order", arguments: input }, context) as Promise<
    McpToolResult<OrderToolOutput>
  >;
}

// 创建支付短链：为指定商品 + 数量生成可跳转的支付入口。
export async function callCreatePaymentLinkTool(
  input: CreatePaymentLinkToolInput,
  context: CommerceToolContext
): Promise<McpToolResult<CreatePaymentLinkToolOutput>> {
  return callPaymentLinkTool({ name: "commerce.create_payment_link", arguments: input }, context);
}
