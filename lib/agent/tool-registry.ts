import { callAiQuoteCartTool, callAiReconcileCartTool, callAiSubmitOrderTool, callCatalogSearchTool } from "@/lib/mcp/client";
import type { AiCartToolOutput, AiOrderToolOutput, AiQuoteCartToolInput, AiQuoteToolOutput, AiReconcileCartToolInput, AiSubmitOrderToolInput, CatalogSearchToolInput, CatalogSearchToolOutput, McpToolResult } from "@/lib/mcp/types";

/**
 * Agent 可见的工具注册表。
 * LLM 只能选择这里声明的业务工具，不能直接访问 MCP Server 或数据库。
 */
export const agentToolRegistry = {
  search_products: (input: CatalogSearchToolInput): Promise<McpToolResult<CatalogSearchToolOutput>> =>
    callCatalogSearchTool(input),
  ai_reconcile_cart: (input: AiReconcileCartToolInput, context: { userid: string }): Promise<McpToolResult<AiCartToolOutput>> => callAiReconcileCartTool(input, context),
  ai_quote_cart: (input: AiQuoteCartToolInput, context: { userid: string }): Promise<McpToolResult<AiQuoteToolOutput>> => callAiQuoteCartTool(input, context),
  ai_submit_order: (input: AiSubmitOrderToolInput, context: { userid: string }): Promise<McpToolResult<AiOrderToolOutput>> => callAiSubmitOrderTool(input, context),
} as const;

export type AgentToolName = keyof typeof agentToolRegistry;

export type AgentToolInput = CatalogSearchToolInput | AiReconcileCartToolInput | AiQuoteCartToolInput | AiSubmitOrderToolInput;
export type AgentToolOutput = CatalogSearchToolOutput | AiCartToolOutput | AiQuoteToolOutput | AiOrderToolOutput;

export async function invokeAgentTool(name: "search_products", input: CatalogSearchToolInput): Promise<McpToolResult<CatalogSearchToolOutput>>;
export async function invokeAgentTool(name: "ai_reconcile_cart", input: AiReconcileCartToolInput, context: { userid: string }): Promise<McpToolResult<AiCartToolOutput>>;
export async function invokeAgentTool(name: "ai_quote_cart", input: AiQuoteCartToolInput, context: { userid: string }): Promise<McpToolResult<AiQuoteToolOutput>>;
export async function invokeAgentTool(name: "ai_submit_order", input: AiSubmitOrderToolInput, context: { userid: string }): Promise<McpToolResult<AiOrderToolOutput>>;
export async function invokeAgentTool(name: AgentToolName, input: AgentToolInput, context?: { userid: string }): Promise<McpToolResult<AgentToolOutput>> {
  if (name === "ai_submit_order" || name === "ai_reconcile_cart" || name === "ai_quote_cart") return agentToolRegistry[name](input as never, context as { userid: string }) as Promise<McpToolResult<AgentToolOutput>>;
  return agentToolRegistry[name](input as never) as Promise<McpToolResult<AgentToolOutput>>;
}

