import {
  isEmptyIntent,
  emptyIntent,
  makeIntentSummary,
  isSearchResolution,
  resolveAssistantIntent,
  type IntentResolution,
} from "@/lib/intent";
import { invokeAgentTool } from "@/lib/agent/tool-registry";
import { appendTurn, getOrCreateSession, updateSessionContext } from "@/lib/agent/session-store";
import type { CatalogSearchToolOutput } from "@/lib/mcp/types";
import type { ProductSearchIntent } from "@/lib/catalog";
import { normalizeSearchConstraints } from "@/lib/intent/search-constraints";
import type { IntentRouting, SearchResolution } from "@/lib/intent/type";

// Agent 商品搜索的统一返回结构：成功时返回解析后的意图与商品数据，失败时返回结构化错误码。
export type ProductAgentResult =
  | {
      ok: true;
      intent: ProductSearchIntent;
      routing: IntentRouting;
      reply?: string;
      sessionId: string;
      data: CatalogSearchToolOutput;
    }
  | { ok: false; code: string; message: string; retryable?: boolean };

/**
 * Agent 编排层：LLM 只解析意图，工具注册表负责调用目录 MCP。
 *
 * 职责：把「自然语言查询」编排成一次完整的商品搜索，串起会话记忆、
 * 统一意图识别、工具调用与结果回写；本入口只消费搜索决策。
 */
export async function searchProductsForAgent(
  query: string,
  pageSize: number,
  cursor?: string,
  sessionId?: string,
  prepared?: SearchResolution,
  includeAlternatives = false
): Promise<ProductAgentResult> {
  // 1. 复用或新建会话，历史消息与当前结构化状态分别读取。
  const session = getOrCreateSession(sessionId);

  // 2. 新消息经过统一分层识别；服务端任务复用已解析的完整条件。
  let parsed: IntentResolution;
  try {
    parsed = prepared
      ? {
          intent: normalizeSearchConstraints(prepared.intent),
          routing: prepared.routing,
        }
      : await resolveAssistantIntent(
          query,
          session.turns,
          session.context
        );
  } catch {
    return {
      ok: false,
      code: "INTENT_PARSE_UNAVAILABLE",
      message: "助手暂时无法理解这次查询，请稍后重试。",
      retryable: true,
    };
  }

  // 3. 统一入口已完成条件合并；只准入搜索动作，不执行其他能力。
  const intent: ProductSearchIntent = isSearchResolution(parsed)
    ? parsed.intent
    : emptyIntent();

  // 4. 空意图（闲聊/超域）不检索商品，直接返回空结果。
  if (isEmptyIntent(intent)) {
    return {
      ok: true,
      intent,
      sessionId: session.sessionId,
      routing: parsed.routing,
      reply:
        parsed.reply ||
        "当前是商品搜索入口；查看进度、确认/取消或分析评论请使用 AI 助理对话入口。",
      data: { products: [], nextCursor: null },
    };
  }

  // 5. 通过工具注册表调用目录 MCP，真正执行商品检索。
  const result = await invokeAgentTool("search_products", {
    intent,
    pageSize,
    cursor,
    ...(includeAlternatives ? { includeAlternatives: true } : {}),
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
    intentSummary: makeIntentSummary(intent),
  });
  updateSessionContext(session.sessionId, {
    product: result.data.products.find((product) => product.stock > 0),
    phase: result.data.clarification ? "needs_clarification" : "search",
    dialogue: {
      intent,
      routing: parsed.routing,
      unresolvedRequired: result.data.clarificationContext?.unresolvedRequired ?? [],
      unresolvedPreferences: result.data.clarificationContext?.unresolvedPreferences ?? [],
      pendingSlot: result.data.clarificationContext?.pendingSlot,
    },
  });
  return {
    ok: true,
    intent,
    sessionId: session.sessionId,
    data: result.data,
    routing: parsed.routing,
  };
}
