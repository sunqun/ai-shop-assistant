import { isEmptyIntent, makeIntentSummary, mergeIntent, parseProductSearchIntentWithMode } from "@/lib/assistant-agent";
import { invokeAgentTool } from "@/lib/agent/tool-registry";
import { appendTurn, getOrCreateSession } from "@/lib/agent/session-store";
import type { CatalogSearchToolOutput } from "@/lib/mcp/types";

export type ProductAgentResult =
  | {
      ok: true;
      intent: Awaited<ReturnType<typeof parseProductSearchIntentWithMode>>["intent"];
      searchMode: "model" | "fallback";
      sessionId: string;
      data: CatalogSearchToolOutput;
    }
  | { ok: false; code: string; message: string; retryable?: boolean };

/**
 * M4 商品 Agent 编排层：LLM 只解析意图，工具注册表负责调用目录 MCP。
 */
export async function searchProductsForAgent(
  query: string,
  pageSize: number,
  cursor?: string,
  sessionId?: string
): Promise<ProductAgentResult> {
  const session = getOrCreateSession(sessionId);
  const previousIntent = session.turns.at(-1)?.intent;
  let parsed;
  try {
    parsed = await parseProductSearchIntentWithMode(
      query,
      session.turns.map((turn) => ({ query: turn.query, intentSummary: turn.intentSummary }))
    );
  } catch {
    return {
      ok: false,
      code: "INTENT_PARSE_UNAVAILABLE",
      message: "助手暂时无法理解这次查询，请稍后重试。",
      retryable: true,
    };
  }

  // 服务端确定性合并：本轮若无新增商品/品类/品牌词，则继承上一轮检索主体。
  const intent = mergeIntent(previousIntent, parsed.intent);

  // 空意图（闲聊/超域）不检索商品。
  if (isEmptyIntent(intent)) {
    return {
      ok: true,
      intent,
      searchMode: parsed.searchMode,
      sessionId: session.sessionId,
      data: { products: [], nextCursor: null },
    };
  }

  const result = await invokeAgentTool("search_products", {
    intent,
    pageSize,
    cursor,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.error.code,
      message: result.error.message,
      retryable: result.error.retryable,
    };
  }
  appendTurn(session.sessionId, {
    query,
    intent,
    intentSummary: makeIntentSummary(intent),
  });
  return {
    ok: true,
    intent,
    searchMode: parsed.searchMode,
    sessionId: session.sessionId,
    data: result.data,
  };
}
