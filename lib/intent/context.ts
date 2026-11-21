/**
 * 上下文解析：处理必须结合上一轮对话才能理解的输入。
 *
 * 三条确定性规则（不经过 LLM）：
 *   1. 补数字槽位——上一轮有 pendingSlot 待用户回答，本轮回复数值则填回约束；
 *   2. 「再便宜一点」——把价格上限压到当前候选价格以下；
 *   3. 「就它吧」——在澄清阶段接受当前候选商品。
 * 命中即返回 SearchResolution，未命中返回 undefined 交由上层继续解析。
 */
import type { ProductSearchIntent } from "@/lib/catalog/types";
import { parseNumericReply } from "@/lib/catalog/measurement";
import { normalizeCommandText } from "@/lib/common/text";
import { matchesContextCommand } from "./commands";
import type { DialogueContext, IntentRouting, SearchResolution } from "./type";

// 构造 context 层路由：这些判断都来自确定性状态，置信度固定为 1。
function routing(action: IntentRouting["action"], reason: string): IntentRouting {
  return { layer: "context", engine: "state", action, confidence: 1, reason };
}

// 深拷贝意图，避免在后续修改时污染上一轮的原始意图对象。
function copyIntent(intent: ProductSearchIntent): ProductSearchIntent {
  return JSON.parse(JSON.stringify(intent)) as ProductSearchIntent;
}

export function resolveSearchContext(
  query: string,
  context: DialogueContext
): SearchResolution | undefined {
  const previous = context.dialogue;
  // 没有上一轮对话就没有上下文可依赖。
  if (!previous) return undefined;
  const text = normalizeCommandText(query);
  const slot = previous.pendingSlot;
  // 规则一：补数字槽位。上一轮有 pendingSlot（kind=number）等待用户回答具体数值。
  if (slot?.kind === "number") {
    const reply = parseNumericReply(text, slot);
    if (reply) {
      const { value, unit, operator } = reply;
      const intent = copyIntent(previous.intent);
      // 覆盖同一 attribute+operator 的旧约束，写入新数值。
      intent.numericConstraints = [
        ...(intent.numericConstraints ?? []).filter(
          (item) => !(item.attribute === slot.attribute && item.operator === operator)
        ),
        { attribute: slot.attribute, operator, value, unit },
      ];
      // 槽位已被回答，从各条件列表中移除对应的待补条件。
      intent.preferences = intent.preferences?.filter((condition) => condition !== slot.condition);
      intent.requiredConditions = intent.requiredConditions?.filter(
        (condition) => condition !== slot.condition
      );
      intent.unresolvedConditions = intent.unresolvedConditions?.filter(
        (condition) => condition !== slot.condition
      );
      return { intent, routing: routing("fill_slot", "answer_to_pending_numeric_slot") };
    }
  }
  // 规则二：「再便宜一点」——把价格上限压到当前候选价格以下（严格更低）。
  if (matchesContextCommand("cheaper", text) && context.product && context.product.price > 0) {
    const intent = copyIntent(previous.intent);
    intent.maxPrice = Math.min(
      intent.maxPrice ?? Infinity,
      Math.round((context.product.price - 0.01) * 100) / 100
    );
    // 价格变了，之前锁定的候选商品不再适用，清掉 productIds。
    delete intent.productIds;
    return { intent, routing: routing("refine_search", "strictly_below_current_candidate_price") };
  }
  // 规则三：「就它吧」——在澄清阶段接受当前候选商品。
  if (
    matchesContextCommand("accept", text) &&
    context.phase === "needs_clarification" &&
    context.product &&
    !previous.unresolvedRequired?.length &&
    !previous.intent.unresolvedConditions?.length
  ) {
    const intent = copyIntent(previous.intent);
    // 只接受当前唯一焦点商品的偏好差异；从不略过未知的必需条件。
    intent.productIds = [context.product.id];
    // 已被用户默认接受的偏好不再视为待澄清项。
    intent.preferences = intent.preferences?.filter(
      (condition) => !previous.unresolvedPreferences.includes(condition)
    );
    return { intent, routing: routing("select_product", "accept_current_candidate_preferences") };
  }
  return undefined;
}
