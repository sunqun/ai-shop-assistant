import { parseProductSearchIntent } from "@/lib/assistant-agent";
import { invokeAgentTool } from "@/lib/agent/tool-registry";
import type { CatalogSearchToolOutput } from "@/lib/mcp/types";

export type ProductAgentResult =
  | { ok: true; intent: Awaited<ReturnType<typeof parseProductSearchIntent>>; data: CatalogSearchToolOutput }
  | { ok: false; code: string; message: string; retryable?: boolean };

/**
 * M4 商品 Agent 编排层：LLM 只解析意图，工具注册表负责调用目录 MCP。
 */
export async function searchProductsForAgent(query: string, pageSize: number, cursor?: string): Promise<ProductAgentResult> {
  let intent;
  try {
    intent = await parseProductSearchIntent(query);
  } catch {
    return { ok: false, code: "INTENT_PARSE_UNAVAILABLE", message: "助手暂时无法理解这次查询，请稍后重试。", retryable: true };
  }

  const result = await invokeAgentTool("search_products", { intent, pageSize, cursor });
  if (!result.ok) {
    return {
      ok: false,
      code: result.error.code,
      message: result.error.message,
      retryable: result.error.retryable,
    };
  }
  return { ok: true, intent, data: result.data };
}

