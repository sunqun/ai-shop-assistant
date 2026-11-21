import { searchCatalogProducts } from "@/lib/catalog";
import { readProductReviewSnapshot } from "@/lib/catalog/reviews";
import type { ProductReviewsToolOutput } from "./types";
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
  if (
    !input ||
    !input.intent ||
    !Number.isInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 100
  ) {
    return { ok: false, error: { code: "MCP_INVALID_ARGUMENTS", message: "商品查询参数无效。" } };
  }

  try {
    const data = await searchCatalogProducts(input.intent, input.pageSize, input.cursor);
    return { ok: true, data };
  } catch (error) {
    console.error(
      "catalog MCP tool failed",
      error instanceof Error ? error.message : "unknown error"
    );
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

export async function callProductReviewsTool(
  call: McpToolCall<"catalog.read_product_reviews">
): Promise<McpToolResult<ProductReviewsToolOutput>> {
  const input = call.arguments;
  if (
    call.name !== "catalog.read_product_reviews" ||
    !input ||
    typeof input.productId !== "string" ||
    !input.productId.trim() ||
    input.productId.length > 100 ||
    !Number.isInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 100 ||
    (input.cursor !== undefined && (typeof input.cursor !== "string" || input.cursor.length > 1500))
  )
    return { ok: false, error: { code: "MCP_INVALID_ARGUMENTS", message: "评论读取参数无效。" } };
  try {
    return {
      ok: true,
      data: await readProductReviewSnapshot(input.productId, input.pageSize, input.cursor),
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "REVIEWS_UNAVAILABLE",
        message: "评论分页读取失败，可稍后继续分析。",
        retryable: true,
      },
    };
  }
}
