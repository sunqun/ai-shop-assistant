import { callCatalogTool } from "@/lib/mcp/catalog-server";
import { callCommerceTool, type CommerceToolContext } from "@/lib/mcp/commerce-server";
import type { AiCartToolOutput, AiOrderToolOutput, AiQuoteCartToolInput, AiQuoteToolOutput, AiReconcileCartToolInput, AiSubmitOrderToolInput, CatalogSearchToolInput, CatalogSearchToolOutput, McpToolResult } from "@/lib/mcp/types";

/**
 * MCP Client 负责屏蔽传输方式。
 * 当前调用同进程 Server，未来可替换为远程 MCP JSON-RPC 调用而不改 Agent。
 */
export async function callCatalogSearchTool(input: CatalogSearchToolInput): Promise<McpToolResult<CatalogSearchToolOutput>> {
  return callCatalogTool({ name: "catalog.search_products", arguments: input });
}

export async function callAiReconcileCartTool(input: AiReconcileCartToolInput, context: CommerceToolContext): Promise<McpToolResult<AiCartToolOutput>> {
  return callCommerceTool({ name: "commerce.ai_reconcile_cart", arguments: input }, context) as Promise<McpToolResult<AiCartToolOutput>>;
}

export async function callAiQuoteCartTool(input: AiQuoteCartToolInput, context: CommerceToolContext): Promise<McpToolResult<AiQuoteToolOutput>> {
  return callCommerceTool({ name: "commerce.ai_quote_cart", arguments: input }, context) as Promise<McpToolResult<AiQuoteToolOutput>>;
}

export async function callAiSubmitOrderTool(input: AiSubmitOrderToolInput, context: CommerceToolContext): Promise<McpToolResult<AiOrderToolOutput>> {
  return callCommerceTool({ name: "commerce.ai_submit_order", arguments: input }, context) as Promise<McpToolResult<AiOrderToolOutput>>;
}

