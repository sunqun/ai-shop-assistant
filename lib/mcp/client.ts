import { callCatalogTool } from "@/lib/mcp/catalog-server";
import type { CatalogSearchToolInput, CatalogSearchToolOutput, McpToolResult } from "@/lib/mcp/types";

/**
 * MCP Client 负责屏蔽传输方式。
 * 当前调用同进程 Server，未来可替换为远程 MCP JSON-RPC 调用而不改 Agent。
 */
export async function callCatalogSearchTool(input: CatalogSearchToolInput): Promise<McpToolResult<CatalogSearchToolOutput>> {
  return callCatalogTool({ name: "catalog.search_products", arguments: input });
}

