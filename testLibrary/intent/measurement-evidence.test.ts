import { describe, expect, it } from "vitest";
import { normalizeMeasurement, parseNumericReply, parseNumericValue } from "@/lib/catalog/measurement";
import { findNumericConstraintConflict, validateConstraintEvidence } from "@/lib/intent/search-constraints";
import { mergeIntent } from "@/lib/intent/intent-utils";
import type { NumericSpecConstraint } from "@/lib/catalog/types";
import { intent, slot } from "./fixtures";

const constraint = (patch: Partial<NumericSpecConstraint> = {}): NumericSpecConstraint => ({
  attribute: "容量", operator: "gte", value: 20000, unit: "mAh", evidence: "至少20000mAh", ...patch,
});
describe("INT-NUM: 数值词法和原话证据", () => {
  it.each([["两万", 20000], ["二萬", 20000], ["1.5万", 15000], ["零", 0]])("明确数值 %s", (text, expected) => {
    expect(parseNumericValue(String(text))).toBe(expected);
  });
  it.each(["一万二", "-1", "1.2.3", "一二", "9007199254740992"])("不接受歧义或非法数值 %s", (text) => {
    expect(parseNumericValue(text)).toBeUndefined();
  });
  it("同维度换算，跨维度不混淆", () => {
    expect(normalizeMeasurement(20, "Ah")).toEqual(normalizeMeasurement(20000, "mAh"));
    expect(normalizeMeasurement(200, "g").dimension).not.toBe(normalizeMeasurement(200, "mAh").dimension);
  });
  it.each(["超过20000mAh", "小于20000mAh", "至少20000mAh以下", "-20000mAh", "200g"])("严格比较/冲突比较/错误维度不补槽 %s", (text) => {
    expect(parseNumericReply(text, slot)).toBeUndefined();
  });
  it("原话中唯一连续证据与比较符一致才保留条件", () => {
    const result = validateConstraintEvidence(intent({ numericConstraints: [constraint()] }), "找至少20000mAh的充电宝");
    expect(result.numericConstraints).toEqual([constraint()]);
    expect(result.unresolvedConditions).toEqual([]);
  });
  it.each([
    constraint({ evidence: "不存在的20000mAh" }), constraint({ operator: "lte" }),
    constraint({ value: 30000 }), constraint({ evidence: undefined }),
  ])("不接受编造、方向错误或缺少依据的约束 %j", (candidate) => {
    const result = validateConstraintEvidence(intent({ numericConstraints: [candidate] }), "至少20000mAh的充电宝");
    expect(result.numericConstraints).toEqual([]);
    expect(result.unresolvedConditions?.length).toBeGreaterThan(0);
  });
  it("原话中规格数字被漏提时仍阻断自动购买", () => {
    expect(validateConstraintEvidence(intent(), "找至少20000mAh充电宝").unresolvedConditions?.length).toBeGreaterThan(0);
  });
  it("完整商品型号中的数字不当成漏提规格", () => {
    expect(validateConstraintEvidence(intent({ keywords: ["Model 20W"] }), "找Model 20W").unresolvedConditions).toEqual([]);
  });
  it("模型漏填数值时允许可信槽位生成属性，不凭空猜属性", () => {
    const result = validateConstraintEvidence(intent(), "20000", { pendingSlot: slot });
    expect(result.numericConstraints).toEqual([{ attribute: "容量", value: 20000, unit: "mAh", operator: "gte" }]);
  });
  it("继承已核实的历史约束无需伪造本轮证据", () => {
    const previous = constraint({ evidence: undefined });
    expect(validateConstraintEvidence(intent({ numericConstraints: [previous] }), "还要蓝色", { inheritedConstraints: [previous] }).numericConstraints).toEqual([previous]);
  });
  it("同一数值片段不能重复绑定两个不同属性", () => {
    const result = validateConstraintEvidence(intent({ numericConstraints: [constraint(), constraint({ attribute: "另一属性" })] }), "至少20000mAh");
    expect(result.numericConstraints).toHaveLength(1);
    expect(result.unresolvedConditions?.length).toBeGreaterThan(0);
  });
  it.each(["不要至少20000mAh的充电宝", "至少20000mAh的不要", "排除至少20000mAh的款式"])("BUG-I01：阻断否定数值 %s", (query) => {
    const result = validateConstraintEvidence(intent({ numericConstraints: [constraint()] }), query);
    expect(result.numericConstraints).toEqual([]);
    expect(result.unresolvedConditions?.length).toBeGreaterThan(0);
  });
  it("不把不低于/不超过比较词误当否定", () => {
    const candidate = constraint({ evidence: "不低于20000mAh" });
    expect(validateConstraintEvidence(intent({ numericConstraints: [candidate] }), "容量不低于20000mAh").numericConstraints).toEqual([candidate]);
  });
});
describe("INT-MERGE: 多轮继承与显式撤销语义", () => {
  it.each([
    ["gte", "lte"], ["lte", "gte"], ["eq", "lte"], ["gte", "eq"],
  ] as const)("追加%s对应的%s条件时保留未撤销的旧边界", (oldOperator, newOperator) => {
    const old = constraint({ operator: oldOperator });
    const next = constraint({ operator: newOperator, value: 30000 });
    const result = mergeIntent(intent({ numericConstraints: [old] }), intent({ keywords: [], numericConstraints: [next] }));
    expect(result.numericConstraints).toEqual([old, next]);
  });
  it("更新同侧边界时保留另一侧边界，并按量纲识别不同单位", () => {
    const upper = constraint({ operator: "lte", value: 30000 });
    const next = constraint({ value: 25, unit: "Ah" });
    const previous = intent({ numericConstraints: [constraint(), upper] });
    const before = JSON.stringify(previous);
    const result = mergeIntent(previous, intent({ keywords: [], numericConstraints: [next] }));
    expect(result.numericConstraints).toEqual([upper, next]);
    expect(JSON.stringify(previous)).toBe(before);
  });
  it("替换整个属性范围必须显式撤销，且不能删除其他属性", () => {
    const weight = constraint({ attribute: "重量", operator: "lte", value: 200, unit: "g" });
    const next = constraint({ operator: "eq", value: 25000 });
    const result = mergeIntent(
      intent({ numericConstraints: [constraint(), constraint({ operator: "lte", value: 30000 }), weight] }),
      intent({ numericConstraints: [next] }),
      [{ field: "numericConstraints", operation: "remove", values: ["容量"], evidence: "容量改成25000mAh，不再限制原范围" }]
    );
    expect(result.numericConstraints).toEqual([weight, next]);
  });
  it("同名属性量纲变化时保留旧条件，交给冲突检查澄清", () => {
    const old = constraint();
    const next = constraint({ value: 200, unit: "g" });
    const result = mergeIntent(intent({ numericConstraints: [old] }), intent({ numericConstraints: [next] }));
    expect(result.numericConstraints).toEqual([old, next]);
    expect(findNumericConstraintConflict(result)).toContain("单位不一致");
  });
  it("修改同一数值属性替换旧约束，不影响其他属性", () => {
    const result = mergeIntent(intent({ numericConstraints: [constraint(), constraint({ attribute: "重量", value: 200, unit: "g", operator: "lte" })] }), intent({ numericConstraints: [constraint({ value: 30000 })] }));
    expect(result.numericConstraints).toHaveLength(2);
    expect(result.numericConstraints).toContainEqual(expect.objectContaining({ attribute: "容量", value: 30000 }));
  });
  it("BUG-I02：显式撤销库存限制，未提及时仍继承", () => {
    const old = intent({ inStockOnly: true });
    expect(mergeIntent(old, intent()).inStockOnly).toBe(true);
    expect(mergeIntent(old, intent(), [{ field: "inStockOnly", operation: "clear", evidence: "缺货也可以" }]).inStockOnly).toBe(false);
  });
  it("BUG-I02：可清空品牌/预算，仅移除被撤销的排除项", () => {
    const old = intent({ brand: "Fixture", maxPrice: 500, excludeTerms: ["黑色", "翻新"] });
    const result = mergeIntent(old, intent(), [
      { field: "brand", operation: "clear", evidence: "品牌不限" },
      { field: "maxPrice", operation: "clear", evidence: "取消预算上限" },
      { field: "excludeTerms", operation: "remove", values: ["黑色"], evidence: "黑色也可以" },
    ]);
    expect(result.brand).toBeUndefined();
    expect(result.maxPrice).toBeUndefined();
    expect(result.excludeTerms).toEqual(["翻新"]);
    expect(old.brand).toBe("Fixture");
  });
  it("BUG-I02：纠错只清除指定历史待核实项，不抹掉其他警告", () => {
    const result = mergeIntent(intent({ unresolvedConditions: ["旧容量错误", "重量未知"] }), intent({ numericConstraints: [constraint()] }), [
      { field: "unresolvedConditions", operation: "remove", values: ["旧容量错误"], evidence: "刚才说错容量，改成至少20000mAh" },
    ]);
    expect(result.unresolvedConditions).toEqual(["重量未知"]);
  });
  it("撤销优先于模型完整意图中重复回传的旧限制", () => {
    const old = intent({ brand: "Fixture", inStockOnly: true, excludeTerms: ["黑色", "翻新"] });
    const result = mergeIntent(old, old, [
      { field: "brand", operation: "clear", evidence: "品牌不限" },
      { field: "inStockOnly", operation: "clear", evidence: "缺货也可以" },
      { field: "excludeTerms", operation: "remove", values: ["黑色"], evidence: "黑色也可以" },
    ]);
    expect(result.brand).toBeUndefined();
    expect(result.inStockOnly).toBe(false);
    expect(result.excludeTerms).toEqual(["翻新"]);
  });
});

describe("INT-RANGE: 数值区间冲突", () => {
  it.each([
    [constraint(), constraint({ operator: "lte", value: 10000 })],
    [constraint({ operator: "eq", value: 10000 }), constraint()],
    [constraint({ operator: "eq" }), constraint({ operator: "eq", value: 30000 })],
    [constraint({ operator: "eq", value: 30000 }), constraint({ operator: "lte" })],
  ])("上下限或等值互相冲突时要求澄清：%j / %j", (left, right) => {
    expect(findNumericConstraintConflict(intent({ numericConstraints: [left, right] }))).toContain("互相冲突");
  });
  it.each([
    [], [constraint()],
    [constraint(), constraint({ operator: "lte", value: 30, unit: "Ah" })],
    [constraint(), constraint({ operator: "lte", value: 20, unit: "Ah" })],
    [constraint(), constraint({ attribute: "重量", operator: "lte", value: 200, unit: "g" })],
    [constraint({ value: 0.1, unit: "Ah" }), constraint({ operator: "lte", value: 100, unit: "mAh" })],
  ])("合法区间、单位换算与不同属性不误报：%j", (...numericConstraints) => {
    expect(findNumericConstraintConflict(intent({ numericConstraints }))).toBeUndefined();
  });
});
