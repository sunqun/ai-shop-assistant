import type { DialogueAction, IntentRouting } from "./type";

type ExactCommand = { action: DialogueAction; reviewMode?: IntentRouting["reviewMode"] };
const commands = new Map<string, ExactCommand>();
function register(
  action: DialogueAction,
  phrases: string[],
  reviewMode?: IntentRouting["reviewMode"]
): void {
  for (const phrase of phrases)
    commands.set(phrase, { action, ...(reviewMode ? { reviewMode } : {}) });
}

// 仅完整命令准入；长句、否定、反问和组合请求交给统一模型路由。
register("confirm_order", ["确认下单", "確認下單", "确认购买", "確認購買", "帮我下单", "幫我下單", "就它吧", "就它", "选这款", "選這款", "就这款", "就這款", "这款可以", "這款可以"]);
register("cancel_task", [
  "取消",
  "取消下单",
  "取消订单",
  "取消購買",
  "取消购买",
  "不要买了",
  "不要買了",
  "别买了",
  "別買了",
]);
register("query_status", [
  "当前进度",
  "目前进度",
  "查询进度",
  "查詢進度",
  "到哪一步了",
  "现在什么状态",
  "現在什麼狀態",
  "订单好了没",
  "訂單好了沒",
]);
register(
  "analyze_reviews",
  [
    "看看评论",
    "看看評論",
    "查看评论",
    "查看評論",
    "分析评论",
    "分析評論",
    "总结评论",
    "總結評論",
    "看看评价",
    "看看評價",
    "看看差评",
    "看看差評",
    "分析差评",
    "分析差評",
    "这款口碑怎么样",
    "這款口碑怎麼樣",
  ],
  "reuse"
);
register(
  "analyze_reviews",
  ["继续分析评论", "繼續分析評論", "继续分析剩余评论", "繼續分析剩餘評論"],
  "continue"
);
register(
  "analyze_reviews",
  ["重新分析评论", "重新分析評論", "刷新评论分析", "刷新評論分析"],
  "refresh"
);

export function matchExactCommand(normalizedText: string): ExactCommand | undefined {
  return commands.get(normalizedText);
}

const contextCommands = {
  cheaper: new Set([
    "再便宜一点",
    "再便宜一點",
    "换个便宜的",
    "換個便宜的",
    "更便宜的",
    "便宜一点的",
    "便宜一點的",
  ]),
};
export function matchesContextCommand(
  kind: keyof typeof contextCommands,
  normalizedText: string
): boolean {
  return contextCommands[kind].has(normalizedText);
}

// 商品名称或别名唯一匹配的语法前缀只在此维护，不用于任意句子提词。
export const CATALOG_SEARCH_PREFIXES = [
  "我想买",
  "我想買",
  "我要买",
  "我要買",
  "有没有",
  "有沒有",
  "帮我找",
  "幫我找",
  "找一下",
  "想买",
  "想買",
  "买",
  "買",
  "找",
] as const;
