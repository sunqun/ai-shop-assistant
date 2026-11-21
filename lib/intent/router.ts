import { routeExactCatalogSubject, routeExactCommand } from "./rules";
import { resolveSearchContext } from "./context";
import { parseModelIntent } from "./model-parser";
import { emptyIntent, mergeIntent } from "./intent-utils";
import { findNumericConstraintConflict } from "./search-constraints";
import { MAX_QUERY_LENGTH } from "./type";
import type {
  DialogueContext,
  IntentDecision,
  IntentHistoryTurn,
  IntentResolution,
  IntentRouting,
} from "./type";

// 所有入口共用的搜索准入；识别出动作不代表调用方获得对应执行权限。
export function isSearchResolution(resolution: IntentResolution): boolean {
  return (
    ["new_search", "refine_search", "fill_slot", "select_product"].includes(
      resolution.routing.action
    ) &&
    resolution.routing.confidence >= 0.8 &&
    (resolution.routing.action !== "select_product" || resolution.routing.engine === "state")
  );
}

function guardSearchConstraints(resolution: IntentResolution): IntentResolution {
  if (!isSearchResolution(resolution)) return resolution;
  if (resolution.intent.minPrice !== undefined &&
      resolution.intent.maxPrice !== undefined && resolution.intent.minPrice > resolution.intent.maxPrice) {
    resolution.routing.action = "clarify";
    resolution.reply = "预算下限高于上限，请确认你的最低预算和最高预算。";
    return resolution;
  }
  const conflict = findNumericConstraintConflict(resolution.intent);
  if (conflict) {
    resolution.routing.action = "clarify";
    resolution.routing.reason = "conflicting_numeric_constraints";
    resolution.reply = conflict;
  }
  return resolution;
}

// 统一识别入口：只返回决策和完整搜索条件，不执行交易、查订单或分析评论。
export async function resolveAssistantIntent(
  query: string, // 用户本轮原始消息
  history: IntentHistoryTurn[] = [], // 历史轮次（仅查询文本 + 意图摘要），用于指代消解
  context?: DialogueContext // 可信任务上下文（阶段、商品、评论分析进度等）
): Promise<IntentResolution> {
  // 归一化查询文本：去首尾空白并截断到全局上限，避免超长输入拖垮解析。
  const text = query.trim().slice(0, MAX_QUERY_LENGTH);
  const state = context ?? {}; // 没有上下文时用空对象，便于下游统一解构
  const previous = state.dialogue?.intent;
  // fromRouting：把「路由决策」封装成统一解析结果的小工具。
  // - intent 默认空意图，仅当规则/上下文层已经给出具体条件时才传入；
  const fromRouting = (
    routing: IntentRouting,
    intent = emptyIntent(),
    reply?: string
  ): IntentResolution => guardSearchConstraints({
    intent,
    routing,
    reply,
  });
  // 空输入直接澄清：置信度 1、由规则引擎命中，不进入后续模型调用。
  if (!text)
    return fromRouting(
      { layer: "rule", engine: "rules", action: "clarify", confidence: 1, reason: "empty_query" },
      emptyIntent(),
      "请说明你想找的商品或希望执行的操作。"
    );

  // 分层识别链，按「确定性从高到低」逐层短路，命中即返回，未命中才落到下一层：
  // 1) 精确命令规则（如「确认下单」「取消下单」等固定口令）；
  const command = routeExactCommand(text);
  if (command) return fromRouting(command);
  // 2) 可信上下文规则（指代消解、状态续接等基于当前任务状态的确定性判断）；
  const contextual = resolveSearchContext(text, state);
  if (contextual) return fromRouting(contextual.routing, contextual.intent);
  // 3) 目录主体精确匹配（商品/品类名直接命中目录，可视为 new 检索）；
  const catalog = await routeExactCatalogSubject(text);
  if (catalog) return catalog;

  // 4) 规则未命中时只进入一次模型解析，同时判断动作并提取本轮搜索条件。
  // 非搜索动作只需决策字段；调用层原有的失败重试不增加独立分类阶段。
  const parsed = await parseModelIntent(text, history, context);
  // 模型不可用时统一澄清。
  const decision: IntentDecision = parsed?.decision ?? {
    action: "clarify",
    confidence: 0,
    reply: "助手暂时无法可靠理解这次请求，请稍后重试。",
  };
  // 模型层的路由统一标记为 fallback 层、llm 引擎；reason 区分「模型不可用」与「正常结构化解析」。
  const routing: IntentRouting = {
    layer: "fallback",
    engine: "llm",
    action: decision.action,
    confidence: decision.confidence,
    reason: parsed ? "structured_intent_parser" : "model_unavailable",
    reviewMode: decision.action === "analyze_reviews" ? decision.reviewMode : undefined,
  };
  const resolution: IntentResolution = {
    intent: decision.action === "new_search" || decision.action === "refine_search"
      ? parsed?.intent ?? emptyIntent()
      : emptyIntent(),
    reply: decision.action === "select_product"
      ? "如需接受当前候选，请明确输入“就这款”；未知的必需条件仍需先核实。"
      : decision.reply || (decision.action === "chat"
        ? "你可以告诉我想买的商品，也可以接着补充当前需求。"
        : undefined),
    routing,
  };
  // 仅补充搜索合并历史；新搜索直接使用本轮条件。
  if (isSearchResolution(resolution)) {
    resolution.intent = decision.action === "new_search"
      ? resolution.intent
      : mergeIntent(previous, resolution.intent, parsed?.edits);
    // 只有可信上下文规则（select_product）可以指定当前候选商品编号；
    // 模型输出不允许沿用旧商品编号，避免模型凭空锁定/替换候选。
    delete resolution.intent.productIds;
  }
  return guardSearchConstraints(resolution);
}

