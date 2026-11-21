import type { NumericSpecConstraint, ProductSearchIntent } from "@/lib/catalog/types";
import { normalizeIdentifier, normalizeWhitespace } from "@/lib/common/text";
import {
  isKnownMeasurementUnit,
  normalizeMeasurement,
  parseNumericReply,
  readNumericExpressions,
  type NumericExpression,
} from "@/lib/catalog/measurement";
import type { NumericDialogueSlot } from "./type";

export type ConstraintEvidenceContext = {
  inheritedConstraints?: NumericSpecConstraint[];
  pendingSlot?: NumericDialogueSlot;
};
type Quantity = { value?: number; unit?: string; operator?: NumericSpecConstraint["operator"] };
function sameQuantity(left: Quantity, right: Quantity): boolean {
  if (
    left.value === undefined ||
    right.value === undefined ||
    !left.operator ||
    left.operator !== right.operator
  )
    return false;
  const a = normalizeMeasurement(left.value, left.unit ?? ""),
    b = normalizeMeasurement(right.value, right.unit ?? "");
  return (
    a.dimension === b.dimension &&
    Math.abs(a.value - b.value) <=
      Math.max(1, Math.abs(a.value), Math.abs(b.value)) * Number.EPSILON * 8
  );
}
const uniqueText = (items: string[]) =>
  [...new Set(items.map(normalizeWhitespace).filter(Boolean))].slice(0, 12);

// 合并后统一检查上下限和等值约束；同属性的不同量纲不能直接比较。
export function findNumericConstraintConflict(intent: ProductSearchIntent): string | undefined {
  const ranges = new Map<string, { dimension: string; min: number; max: number }>();
  for (const constraint of intent.numericConstraints ?? []) {
    const key = normalizeIdentifier(constraint.attribute);
    const quantity = normalizeMeasurement(constraint.value, constraint.unit ?? "");
    const range = ranges.get(key) ?? { dimension: quantity.dimension, min: -Infinity, max: Infinity };
    if (range.dimension !== quantity.dimension)
      return `“${constraint.attribute}”的数值条件单位不一致，请确认后继续。`;
    if (constraint.operator !== "lte") range.min = Math.max(range.min, quantity.value);
    if (constraint.operator !== "gte") range.max = Math.min(range.max, quantity.value);
    const tolerance = Math.max(1, Math.abs(range.min), Math.abs(range.max)) * Number.EPSILON * 8;
    if (range.min > range.max && range.min - range.max > tolerance)
      return `“${constraint.attribute}”的数值条件互相冲突，请确认上下限或等值要求。`;
    ranges.set(key, range);
  }
  return undefined;
}

// 结构整理不删除语义前缀、不猜属性，也不从关键词中重新抽取条件。
export function normalizeSearchConstraints(intent: ProductSearchIntent): ProductSearchIntent {
  const preferences = uniqueText(intent.preferences ?? []);
  const requiredConditions = uniqueText(intent.requiredConditions ?? []).filter(
    (item) => !preferences.includes(item)
  );
  const numericConstraints = [
    ...new Map(
      (intent.numericConstraints ?? [])
        .filter(
          (item) =>
            Number.isFinite(item.value) &&
            item.value >= 0 &&
            ["gte", "lte", "eq"].includes(item.operator)
        )
        .map((item) => {
          const clean = {
            ...item,
            attribute: normalizeWhitespace(item.attribute).slice(0, 80),
            unit: item.unit?.trim().slice(0, 20),
            evidence: item.evidence?.trim().slice(0, 1000),
          };
          const quantity = normalizeMeasurement(clean.value, clean.unit ?? "");
          return [
            JSON.stringify([clean.attribute, clean.operator, quantity.dimension, quantity.value]),
            clean,
          ];
        })
    ).values(),
  ];
  const unresolved = [...(intent.unresolvedConditions ?? [])];
  if (numericConstraints.length > 12)
    unresolved.push("数值条件超过当前处理上限，请拆分或确认后继续。");
  return {
    keywords: uniqueText(intent.keywords),
    quantity: intent.quantity,
    category: intent.category,
    brand: intent.brand,
    minPrice: intent.minPrice,
    maxPrice: intent.maxPrice,
    minRating: intent.minRating,
    inStockOnly: intent.inStockOnly,
    productIds: intent.productIds,
    excludeTerms: intent.excludeTerms,
    excludeBrands: intent.excludeBrands,
    excludeCategories: intent.excludeCategories,
    requiredConditions,
    preferences,
    numericConstraints: numericConstraints.slice(0, 12),
    unresolvedConditions: uniqueText(unresolved),
  };
}

function hasNegatedNumericScope(query: string, start: number, end: number): boolean {
  const before = query.slice(0, start).split(/[，,。；;！？!?\n]/u).at(-1) ?? "";
  const after = query.slice(end).split(/[，,。；;！？!?\n]/u)[0];
  const clause = `${before}${query.slice(start, end)}${after}`
    .replace(/不(?:低于|低於|少于|少於|超过|超過)/gu, "");
  return /(?:不要|不买|不買|不选|不選|不需要|不用|不接受|不考虑|不考慮|不是|不能|别|別|排除|除外|拒绝|拒絕|并非|並非|勿|without|exclude|\bnot\b|don't)/iu.test(clause);
}

function uniqueQuoteRange(
  query: string,
  quote?: string
): { start: number; end: number } | undefined {
  if (!quote) return undefined;
  const start = query.indexOf(quote);
  if (start < 0 || query.indexOf(quote, start + 1) >= 0) return undefined;
  return { start, end: start + quote.length };
}

// 只验证“模型条件与原话一致”，属性由模型或真实槽位提供，不从数字前文猜测。
export function validateConstraintEvidence(
  intent: ProductSearchIntent,
  query: string,
  context: ConstraintEvidenceContext = {}
): ProductSearchIntent {
  const normalized = normalizeSearchConstraints(intent);
  const slot = context.pendingSlot;
  const reply = slot ? parseNumericReply(query, slot) : undefined;
  const expressions: NumericExpression[] = reply
    ? [{ start: 0, end: query.length, raw: query, ...reply }]
    : readNumericExpressions(query);
  const used = new Set<number>();
  const accepted: NumericSpecConstraint[] = [];
  const unresolved = [...(normalized.unresolvedConditions ?? [])];
  const models = normalized.numericConstraints ?? [];
  for (const model of models) {
    const quote = uniqueQuoteRange(query, model.evidence);
    const negated = expressions.some((item) => sameQuantity(model, item) && hasNegatedNumericScope(query, item.start, item.end));
    if (negated) {
      unresolved.push(`数值条件含否定或排除语义，请明确确认：${model.evidence ?? `${model.value}${model.unit ?? ""}`}`);
      continue;
    }
    const matches = expressions
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item, index }) =>
          !used.has(index) &&
          sameQuantity(model, item) &&
          (quote
            ? item.start >= quote.start && item.end <= quote.end
            : !!reply && model.attribute === slot?.attribute)
      );
    if (model.attribute && matches.length === 1) {
      used.add(matches[0].index);
      accepted.push(model);
    } else if (
      (context.inheritedConstraints ?? []).some(
        (previous) => previous.attribute === model.attribute && sameQuantity(previous, model)
      ) &&
      !models.some((other) => other.attribute === model.attribute && !sameQuantity(other, model))
    ) {
      accepted.push(model);
    } else {
      unresolved.push(
        `无法核实原文依据或属性归属的数值条件：${model.attribute || "未确定属性"} ${model.operator} ${model.value}${model.unit ?? ""}`
      );
    }
  }
  // 真实补槽本身已确定属性，模型漏填时也可使用；普通原话不在此生成属性。
  if (reply && slot && !used.has(0) && !models.length) {
    accepted.push({ attribute: slot.attribute, ...reply });
    used.add(0);
  }
  // 商品名称中的型号数字不视为漏提规格；仅核对原文中实际出现的结构化主体片段。
  const names = [...normalized.keywords, normalized.brand, normalized.category].filter(
    (item): item is string => !!item
  );
  const nameRanges = names.flatMap((name) => {
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = query.indexOf(name); start >= 0; start = query.indexOf(name, start + 1))
      ranges.push({ start, end: start + name.length });
    return ranges;
  });
  expressions.forEach((item, index) => {
    if (
      used.has(index) ||
      !isKnownMeasurementUnit(item.unit) ||
      nameRanges.some((range) => item.start >= range.start && item.end <= range.end)
    )
      return;
    unresolved.push(
      `${item.value === undefined || !item.operator ? "无法确认的数值表达" : "尚未确认属性归属或原文依据的数值条件"}：${item.raw}`
    );
  });
  return normalizeSearchConstraints({
    ...normalized,
    numericConstraints: accepted,
    unresolvedConditions: unresolved,
  });
}
