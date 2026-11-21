import { normalizeIdentifier } from "@/lib/common/text";
import { toMinor } from "@/lib/pricing-domain";
import { matchesNumericConstraint } from "./spec-matching";
import { normalizeMeasurement, readMeasurements } from "./measurement";
import type {
  CatalogProduct,
  ProductDifference,
  ProductSearchIntent,
} from "./types";

export function productDifferences(
  product: CatalogProduct,
  intent: ProductSearchIntent,
): ProductDifference[] {
  const differences: ProductDifference[] = [];
  const add = (
    requirement: string,
    actual: string,
    status: ProductDifference["status"] = "not_met",
  ) => differences.push({ requirement, actual, status });
  if (
    intent.brand &&
    normalizeIdentifier(product.brand) !== normalizeIdentifier(intent.brand)
  )
    add(`品牌：${intent.brand}`, `品牌：${product.brand}`);
  if (
    intent.maxPrice !== undefined &&
    toMinor(product.price) > toMinor(intent.maxPrice)
  )
    add(
      `商品单价不超过 ${intent.maxPrice} ${product.currency}`,
      `商品单价 ${product.price} ${product.currency}；最终应付金额以报价为准`,
    );
  if (
    intent.minPrice !== undefined &&
    toMinor(product.price) < toMinor(intent.minPrice)
  )
    add(
      `商品单价至少 ${intent.minPrice} ${product.currency}`,
      `商品单价 ${product.price} ${product.currency}`,
    );
  if (intent.minRating !== undefined && product.rating < intent.minRating)
    add(`评分至少 ${intent.minRating}`, `当前评分 ${product.rating}`);
  for (const term of intent.excludeBrands ?? [])
    if (normalizeIdentifier(product.brand).includes(normalizeIdentifier(term)))
      add(`排除品牌：${term}`, `当前品牌：${product.brand}`);
  for (const term of intent.excludeCategories ?? [])
    if (
      normalizeIdentifier(product.category).includes(normalizeIdentifier(term))
    )
      add(`排除分类：${term}`, `当前分类：${product.category}`);
  for (const term of intent.excludeTerms ?? []) {
    const text = [
      product.name,
      product.brand,
      product.category,
      product.description,
      ...Object.values(product.specs),
    ].join(" ");
    if (normalizeIdentifier(text).includes(normalizeIdentifier(term)))
      add(`排除：${term}`, `当前商品资料包含“${term}”`);
  }
  for (const constraint of intent.numericConstraints ?? []) {
    const entry = Object.entries(product.specs).find(
      ([name]) =>
        normalizeIdentifier(name) === normalizeIdentifier(constraint.attribute),
    );
    const expected = normalizeMeasurement(
      constraint.value,
      constraint.unit ?? "",
    );
    const measurements = entry
      ? readMeasurements(entry[1]).filter(
          (item) => item.dimension === expected.dimension,
        )
      : [];
    const ambiguous = new Set(measurements.map((item) => item.value)).size > 1;
    if (!ambiguous && matchesNumericConstraint(product, constraint)) continue;
    const relation = { gte: "至少", lte: "不超过", eq: "等于" }[
      constraint.operator
    ];
    add(
      `${constraint.attribute}${relation}${constraint.value}${constraint.unit ?? ""}`,
      entry ? `${entry[0]}：${entry[1]}` : "目录中缺少可核实的对应规格",
      entry && !ambiguous && measurements.length ? "not_met" : "unverified",
    );
  }
  return differences;
}
