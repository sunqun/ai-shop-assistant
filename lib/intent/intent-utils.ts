import type { ProductSearchIntent } from "@/lib/catalog";
import { normalizeSearchConstraints } from "./search-constraints";
import { applyIntentEdits, removeRevokedEchoes } from "./intent-edits";
import { normalizeMeasurement } from "@/lib/catalog/measurement";
import { normalizeIdentifier } from "@/lib/common/text";
import type { IntentEdit } from "./type";

export const emptyIntent = (): ProductSearchIntent => ({
  keywords: [],
  inStockOnly: false,
});

// 判断意图是否为空（无任何商品/品类/品牌/价格/评分/库存/排除条件），用于短路闲聊或超域查询。
export function isEmptyIntent(intent: ProductSearchIntent): boolean {
  return (
    !intent.keywords.length &&
    !intent.productIds?.length &&
    !intent.numericConstraints?.length &&
    !intent.requiredConditions?.length &&
    !intent.preferences?.length &&
    !intent.unresolvedConditions?.length &&
    !intent.category &&
    !intent.brand &&
    intent.minPrice === undefined &&
    intent.maxPrice === undefined &&
    intent.minRating === undefined &&
    !intent.inStockOnly &&
    !intent.excludeTerms?.length &&
    !intent.excludeBrands?.length &&
    !intent.excludeCategories?.length
  );
}

// 补充搜索时优先使用本轮字段，缺失的条件沿用上一轮。
export function mergeIntent(
  previous: ProductSearchIntent | undefined,
  current: ProductSearchIntent,
  edits: IntentEdit[] = []
): ProductSearchIntent {
  if (!previous) return current;
  current = removeRevokedEchoes(previous, current, edits);
  previous = applyIntentEdits(previous, edits);
  return normalizeSearchConstraints({
    keywords: current.keywords.length ? current.keywords : previous.keywords,
    quantity: current.quantity ?? previous.quantity,
    category: current.category ?? previous.category,
    brand: current.brand ?? previous.brand,
    minPrice: current.minPrice ?? previous.minPrice,
    maxPrice: current.maxPrice ?? previous.maxPrice,
    minRating: current.minRating ?? previous.minRating,
    inStockOnly: current.inStockOnly || previous.inStockOnly,
    requiredConditions: [
      ...new Set([...(previous.requiredConditions ?? []), ...(current.requiredConditions ?? [])]),
    ],
    preferences: [...new Set([...(previous.preferences ?? []), ...(current.preferences ?? [])])],
    // 只替换同属性、同量纲、同侧边界；另一侧边界和等值条件必须显式撤销。
    numericConstraints: [
      ...(previous.numericConstraints ?? []).filter(
        (constraint) =>
          !current.numericConstraints?.some((next) =>
            normalizeIdentifier(next.attribute) === normalizeIdentifier(constraint.attribute) &&
            next.operator === constraint.operator &&
            normalizeMeasurement(next.value, next.unit ?? "").dimension ===
              normalizeMeasurement(constraint.value, constraint.unit ?? "").dimension
          )
      ),
      ...(current.numericConstraints ?? []),
    ],
    unresolvedConditions: [
      ...new Set([
        ...(previous.unresolvedConditions ?? []),
        ...(current.unresolvedConditions ?? []),
      ]),
    ],
    excludeTerms: [...new Set([...(previous.excludeTerms ?? []), ...(current.excludeTerms ?? [])])],
    excludeBrands: [
      ...new Set([...(previous.excludeBrands ?? []), ...(current.excludeBrands ?? [])]),
    ],
    excludeCategories: [
      ...new Set([...(previous.excludeCategories ?? []), ...(current.excludeCategories ?? [])]),
    ],
  });
}

// 把结构化意图压缩成一句人类可读的摘要，用于展示与作为下一轮 LLM 的历史上下文。
export function makeIntentSummary(intent: ProductSearchIntent): string {
  const positive = [
    intent.quantity !== undefined ? `数量${intent.quantity}件` : undefined,
    intent.category,
    intent.brand,
    intent.keywords.join("、"),
    intent.requiredConditions?.join("、"),
    intent.numericConstraints
      ?.map(
        (constraint) =>
          `${constraint.attribute} ${constraint.operator} ${constraint.value}${constraint.unit ?? ""}`
      )
      .join("、"),
    intent.minPrice !== undefined || intent.maxPrice !== undefined
      ? `${intent.minPrice ?? 0}-${intent.maxPrice ?? "不限"} ${"元"}`
      : undefined,
    intent.inStockOnly ? "有库存" : undefined,
  ].filter(Boolean);
  const exclude = [
    ...(intent.excludeTerms ?? []),
    ...(intent.excludeBrands ?? []),
    ...(intent.excludeCategories ?? []),
  ];
  const base = positive.length ? `已按“${positive.join("，")}”筛选` : "已按你的描述查找相关商品";
  const exclusions = exclude.length ? `，排除：${exclude.join("、")}` : "";
  const preferences = intent.preferences?.length ? `；偏好：${intent.preferences.join("、")}` : "";
  return `${base}${exclusions}${preferences}`;
}
