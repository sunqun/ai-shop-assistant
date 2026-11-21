import type { ProductSearchIntent } from "@/lib/catalog/types";
import type { IntentEdit } from "./type";

const REVISION_EVIDENCE = /(?:取消|撤销|撤銷|去掉|移除|删除|刪除|不用|不需要|不再|不限|不限制|不设|不設|也可以|都可以|无所谓|無所謂|改为|改為|改成|改到|更正|纠正|糾正|说错|說錯)/u;

export function validateIntentEdits(edits: IntentEdit[] | undefined, query: string): IntentEdit[] {
  return (edits ?? []).filter((edit) => {
    const start = query.indexOf(edit.evidence);
    return start >= 0 && query.indexOf(edit.evidence, start + 1) < 0 && REVISION_EVIDENCE.test(edit.evidence);
  });
}

// 明确撤销与未提及是不同操作。只修改已存在字段，不允许编辑指定商品ID。
export function applyIntentEdits(previous: ProductSearchIntent, edits: IntentEdit[]): ProductSearchIntent {
  const result: ProductSearchIntent = JSON.parse(JSON.stringify(previous));
  for (const edit of edits) {
    const field = edit.field;
    if (edit.operation === "clear") {
      if (field === "inStockOnly") result.inStockOnly = false;
      else delete result[field];
    } else {
      const values = new Set(edit.values ?? []);
      if (field === "numericConstraints") {
        result.numericConstraints = result.numericConstraints?.filter((item) => !values.has(item.attribute));
      } else if (["requiredConditions", "preferences", "excludeTerms", "excludeBrands", "excludeCategories", "unresolvedConditions"].includes(field)) {
        const arrayField = field as "requiredConditions" | "preferences" | "excludeTerms" | "excludeBrands" | "excludeCategories" | "unresolvedConditions";
        result[arrayField] = result[arrayField]?.filter((value) => !values.has(value));
      }
    }
  }
  return result;
}

// 模型可能在完整意图里重复回传已经撤销的旧值；撤销优先于这些重复值。
// 本轮新生成的未核实警告不能被历史撤销操作抹掉。
export function removeRevokedEchoes(previous: ProductSearchIntent, current: ProductSearchIntent, edits: IntentEdit[]): ProductSearchIntent {
  const result: ProductSearchIntent = JSON.parse(JSON.stringify(current));
  for (const edit of edits) {
    const field = edit.field;
    if (field === "unresolvedConditions") continue;
    if (field === "numericConstraints") {
      const attributes = edit.operation === "clear" ? undefined : new Set(edit.values ?? []);
      result.numericConstraints = result.numericConstraints?.filter((item) =>
        !(previous.numericConstraints ?? []).some((old) => (!attributes || attributes.has(old.attribute)) &&
          old.attribute === item.attribute && old.operator === item.operator && old.value === item.value && old.unit === item.unit));
    } else if (["requiredConditions", "preferences", "excludeTerms", "excludeBrands", "excludeCategories"].includes(field)) {
      const arrayField = field as "requiredConditions" | "preferences" | "excludeTerms" | "excludeBrands" | "excludeCategories";
      const revoked = new Set(edit.operation === "clear" ? previous[arrayField] ?? [] : edit.values ?? []);
      result[arrayField] = result[arrayField]?.filter((value) => !revoked.has(value));
    } else if (edit.operation === "clear" && result[field] === previous[field]) {
      if (field === "inStockOnly") result.inStockOnly = false;
      else delete result[field];
    }
  }
  return result;
}
