import { searchCatalogProducts } from "@/lib/catalog";
import type {
  CatalogSearchToolInput,
  CatalogSearchToolOutput,
  McpToolCall,
  McpToolResult,
} from "@/lib/mcp/types";

/**
 * 商品目录 MCP Server。
 *
 * Server 只暴露业务工具，不接受 SQL、排序字段或内部推荐权重等参数。
 * 别名展开、库存过滤和内部排序仍由目录域服务负责。
 */
export async function callCatalogTool(
  call: McpToolCall<"catalog.search_products">
): Promise<McpToolResult<CatalogSearchToolOutput>> {
  if (call.name !== "catalog.search_products") {
    return { ok: false, error: { code: "MCP_TOOL_NOT_FOUND", message: "商品目录工具不存在。" } };
  }

  const input = call.arguments as CatalogSearchToolInput;
  if (!input || !input.intent || !Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    return { ok: false, error: { code: "MCP_INVALID_ARGUMENTS", message: "商品查询参数无效。" } };
  }

  try {
    const data = await searchCatalogProducts(input.intent, input.pageSize, input.cursor);
    return { ok: true, data };
  } catch (error) {
    console.error("catalog MCP tool failed", error instanceof Error ? error.message : "unknown error");
    return {
      ok: false,
      error: {
        code: "CATALOG_QUERY_UNAVAILABLE",
        message: "商品目录暂时无法查询。",
        retryable: true,
      },
    };
  }
}

