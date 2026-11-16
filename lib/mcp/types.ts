/**
 * MCP 工具的最小领域契约。
 *
 * 这里使用进程内传输，保持与未来独立 MCP Server 的 JSON-RPC/HTTP 传输
 * 兼容：调用方只依赖工具名、参数和结构化结果，不依赖数据库实现。
 */
export type McpToolName = "catalog.search_products";

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
  arguments: TName extends "catalog.search_products" ? CatalogSearchToolInput : never;
};

export type CatalogSearchToolInput = {
  intent: import("@/lib/catalog").ProductSearchIntent;
  pageSize: number;
  cursor?: string;
};

export type CatalogSearchToolOutput = import("@/lib/catalog").ProductSearchPage;

