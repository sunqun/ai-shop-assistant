import { isEmptyIntent, makeIntentSummary, mergeIntent, parseProductSearchIntentWithMode } from "@/lib/intent";
import { invokeAgentTool } from "@/lib/agent/tool-registry";
import { appendTurn, getOrCreateSession } from "@/lib/agent/session-store";
import type { CatalogSearchToolOutput } from "@/lib/mcp/types";

// Agent 商品搜索的统一返回结构：成功时返回解析后的意图与商品数据，失败时返回结构化错误码。
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
 * Agent 编排层：LLM 只解析意图，工具注册表负责调用目录 MCP。
 *
 * 职责：把「自然语言查询」编排成一次完整的商品搜索，串起会话记忆、
 * 意图解析、上下文合并、工具调用与结果回写，对外只暴露一个稳定入口。
 */
export async function searchProductsForAgent(
  query: string,
  pageSize: number,
  cursor?: string,
  sessionId?: string
): Promise<ProductAgentResult> {
  // 1. 复用或新建会话，取出上一轮意图用于后续的上下文合并。
  const session = getOrCreateSession(sessionId);
  const previousIntent = session.turns.at(-1)?.intent;

  // 2. 让 LLM 把查询解析成结构化意图；解析失败按「可重试」降级返回。
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

  // 3. 服务端确定性合并：本轮若无新增商品/品类/品牌词，则继承上一轮检索主体。
  const intent = mergeIntent(previousIntent, parsed.intent);

  // 4. 空意图（闲聊/超域）不检索商品，直接返回空结果。
  if (isEmptyIntent(intent)) {
    return {
      ok: true,
      intent,
      searchMode: parsed.searchMode,
      sessionId: session.sessionId,
      data: { products: [], nextCursor: null },
    };
  }

  // 5. 通过工具注册表调用目录 MCP，真正执行商品检索。
  const result = await invokeAgentTool("search_products", {
    intent,
    pageSize,
    cursor,
  });

  // 6. 工具失败则透传错误码与提示，不写回会话历史。
  if (!result.ok) {
    return {
      ok: false,
      code: result.error.code,
      message: result.error.message,
      retryable: result.error.retryable,
    };
  }

  // 7. 检索成功后记录本轮查询与意图摘要，供后续轮次做上下文继承。
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
