import { describe, expect, it } from "vitest";
import { resolveSearchContext } from "@/lib/intent/context";
import { context, dialogue, intent, product, slot } from "./fixtures";

describe("INT-CTX: 可信上下文补槽和选品", () => {
  it("没有历史时不凭空补槽或展开指代", () => {
    expect(resolveSearchContext("就它吧", {})).toBeUndefined();
    expect(resolveSearchContext("20000", {})).toBeUndefined();
  });
  it.each(["20000", "至少20000mAh", "20Ah"])("用真实槽位确定数值属性：%s", (query) => {
    const state = context({ dialogue: dialogue({ pendingSlot: slot, intent: intent({
      preferences: ["大容量", "轻便"], unresolvedConditions: ["大容量"],
      numericConstraints: [{ attribute: "容量", operator: "gte", value: 10000, unit: "mAh" }],
    }) }) });
    const before = JSON.stringify(state);
    const result = resolveSearchContext(query, state);
    expect(result?.routing.action).toBe("fill_slot");
    expect(result?.intent.numericConstraints).toHaveLength(1);
    expect(result?.intent.preferences).toEqual(["轻便"]);
    expect(result?.intent.unresolvedConditions).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each(["很多", "200g", "一万二", "-20000", "不要20000mAh"])("模糊/维度错误/否定不直接补槽：%s", (query) => {
    expect(resolveSearchContext(query, context({ dialogue: dialogue({ pendingSlot: slot }) }))).toBeUndefined();
  });
  it("更便宜必须严格低于候选价，并解除旧商品锁定", () => {
    const result = resolveSearchContext("再便宜一点", context({ dialogue: dialogue({
      intent: intent({ maxPrice: 600, productIds: [product.id] }),
    }) }));
    expect(result?.intent.maxPrice).toBe(499.99);
    expect(result?.intent.productIds).toBeUndefined();
  });
  it("更便宜不放宽已有预算", () => {
    expect(resolveSearchContext("再便宜一点", context({ dialogue: dialogue({ intent: intent({ maxPrice: 300 }) }) }))?.intent.maxPrice).toBe(300);
  });
  it("明确接受仅能消除当前候选的偏好差异", () => {
    const result = resolveSearchContext("就它吧", context({ dialogue: dialogue({
      intent: intent({ preferences: ["轻便", "蓝色"] }), unresolvedPreferences: ["轻便"],
    }) }));
    expect(result?.routing.action).toBe("select_product");
    expect(result?.intent.productIds).toEqual([product.id]);
    expect(result?.intent.preferences).toEqual(["蓝色"]);
  });
  it.each([
    context({ product: undefined }), context({ phase: "ready_to_order" }),
    context({ dialogue: dialogue({ unresolvedRequired: ["快充未知"] }) }),
    context({ dialogue: dialogue({ intent: intent({ unresolvedConditions: ["数值未核实"] }) }) }),
  ])("不得跳过缺候选、错误阶段或必需条件", (state) => {
    expect(resolveSearchContext("就它吧", state)).toBeUndefined();
  });
});
