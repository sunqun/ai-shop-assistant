import { createLLMFromEnv } from "@/lib/llm";
import type { Message } from "@/lib/llm/type";
import { validateConstraintEvidence } from "./search-constraints";
import { intentTool } from "./model-schema";
import { buildIntentSystemPrompt } from "./prompt";
import { validateIntentEdits } from "./intent-edits";
import { validatePurchaseQuantity } from "./purchase-quantity";
import { emptyIntent } from "./intent-utils";
import type { DialogueContext, IntentHistoryTurn, IntentToolOutput } from "./type";

// 最后一层仅供内部路由调用，不通过 index 导出，避免业务入口跳过公共路由。
export async function parseModelIntent(
  query: string,
  history: IntentHistoryTurn[],
  context?: DialogueContext
): Promise<IntentToolOutput | undefined> {
  // 单次解析同时判断动作与提取本轮条件，可读任务上下文，不查询目录或执行交易。
  const messages: Message[] = [
    { role: "system", content: buildIntentSystemPrompt(context) },
    ...history.flatMap<Message>((turn) => [
      { role: "user", content: turn.query },
      { role: "assistant", content: turn.intentSummary },
    ]),
    { role: "user", content: query },
  ];

  try {
    const llm = createLLMFromEnv();
    const result = await llm.invoke(
      messages,
      { parse_product_search_intent: intentTool },
      AbortSignal.timeout(12_000),
      { toolChoiceName: "parse_product_search_intent", temperature: 0 }
    );
    const output = result.toolResult as IntentToolOutput;
    // 非搜索动作不执行规格/件数校验，也不携带搜索条件或历史编辑。
    if (!["new_search", "refine_search"].includes(output.decision.action))
      return { intent: emptyIntent(), decision: output.decision };
    return {
      intent: validatePurchaseQuantity(validateConstraintEvidence(output.intent, query, {
        inheritedConstraints:
          output.decision.action === "new_search"
            ? []
            : context?.dialogue?.intent.numericConstraints,
        pendingSlot: context?.dialogue?.pendingSlot,
      }), query),
      edits: validateIntentEdits(output.edits, query),
      decision: output.decision,
    };
  } catch (error) {
    // 失败统一返回澄清；不再从任意自然语言中猜商品词。
    console.error(
      "parseProductSearchIntent unavailable:",
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}
