import { callCatalogSearchTool } from "@/lib/mcp/client";
import type { CatalogSearchToolInput, CatalogSearchToolOutput, McpToolResult } from "@/lib/mcp/types";

/**
 * Agent 可见的工具注册表。
 * LLM 只能选择这里声明的业务工具，不能直接访问 MCP Server 或数据库。
 */
export const agentToolRegistry = {
  search_products: (input: CatalogSearchToolInput): Promise<McpToolResult<CatalogSearchToolOutput>> =>
    callCatalogSearchTool(input),
} as const;

export type AgentToolName = keyof typeof agentToolRegistry;

export async function invokeAgentTool(
  name: AgentToolName,
  input: CatalogSearchToolInput
): Promise<McpToolResult<CatalogSearchToolOutput>> {
  return agentToolRegistry[name](input);
}

