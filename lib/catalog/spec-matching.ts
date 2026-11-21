/**
 * 商品规格匹配工具集。
 *
 * 提供两类匹配能力：
 *   - 数值匹配：比较指定属性的数值与单位
 *   - 结构化布尔匹配：只接受同名规格中的明确布尔值
 *
 * 自由文本及否定语义统一由上层 condition-assessment 结合原文证据评估。
 */
import type { CatalogProduct, NumericSpecConstraint, ProductSearchIntent } from "./types";
import { normalizeMeasurement, readMeasurements } from "./measurement";
import { normalizeIdentifier } from "@/lib/common/text";

const BOOLEAN_SPEC_VALUES = new Map<string, boolean>([
  ...["true", "yes", "是", "有", "支持", "支援"].map((value): [string, boolean] => [value, true]),
  ...["false", "no", "否", "无", "無", "不支持", "不支援"].map((value): [string, boolean] => [
    value,
    false,
  ]),
]);

// 判断商品是否满足某个数值规格约束（如「容量 gte 20L」）。
export function matchesNumericConstraint(
  product: CatalogProduct,
  constraint: NumericSpecConstraint
): boolean {
  // 先把约束数值+单位归一化到统一量纲，便于与商品规格值比较。
  const expected = normalizeMeasurement(constraint.value, constraint.unit ?? "");
  const attribute = normalizeIdentifier(constraint.attribute);
  const allEntries = Object.entries(product.specs ?? {});
  // 仅精确属性名匹配；不再用互相包含把“宽度”绑定到多个不同属性。
  let entries = attribute
    ? allEntries.filter(([key]) => {
        return normalizeIdentifier(key) === attribute;
      })
    : [];
  if (!entries.length && expected.dimension) {
    // 只有一个规格属性使用该量纲时才允许按单位消解属性名；多个候选时不猜。
    const byDimension = allEntries.filter(([, value]) =>
      readMeasurements(String(value)).some(
        (measurement) => measurement.dimension === expected.dimension
      )
    );
    if (byDimension.length === 1) entries = byDimension;
  }
  if (entries.length !== 1) return false;
  // 解析唯一属性中的数值，取同量纲的数值列表。
  const values = entries
    .flatMap(([, value]) => readMeasurements(String(value)))
    .filter((measurement) => measurement.dimension === expected.dimension)
    .map((measurement) => measurement.value);
  if (!values.length) return false;
  // 依据操作符比较：gte/lte 取最大值比较，eq 判断是否存在相等值。
  if (constraint.operator === "gte") return Math.max(...values) >= expected.value;
  if (constraint.operator === "lte") return Math.max(...values) <= expected.value;
  return values.some((value) => value === expected.value);
}

// 只有同名规格的明确布尔值可直接判定；自由文本的肯定/否定语义交给有原文证据的评估器。
export function checkLiteralCondition(
  product: CatalogProduct,
  condition: string
): "matched" | "contradicted" | "unknown" {
  const needle = normalizeIdentifier(condition);
  if (!needle) return "unknown";
  const entries = Object.entries(product.specs ?? {}).filter(
    ([key]) => normalizeIdentifier(key) === needle
  );
  if (entries.length !== 1) return "unknown";
  const value = BOOLEAN_SPEC_VALUES.get(normalizeIdentifier(entries[0][1]));
  return value === undefined ? "unknown" : value ? "matched" : "contradicted";
}

// 生成搜索澄清提示：候选商品存在且存在无法核实的偏好/条件时返回。
export function describeSearchClarification(
  product: CatalogProduct | undefined,
  intent: ProductSearchIntent,
  unresolved: string[] = intent.preferences ?? []
): string | undefined {
  const preferences = unresolved.filter(Boolean);
  // 没有候选商品，或没有无法核实的偏好时，不生成澄清。
  if (!product || !preferences.length) return undefined;
  const facts = Object.entries(product.specs ?? {})
    .map(([key, value]) => `${key} ${value}`)
    .join("，");
  return `找到「${product.name}」${facts ? `，规格：${facts}` : ""}。尚不能核实“${preferences.join("、")}”是否符合，请补充明确标准；核实前不会加入购物车。`;
}
