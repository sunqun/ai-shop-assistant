import { describe, expect, it } from "vitest";
import { calculateBestQuote } from "@/lib/pricing-domain";

// 折前商品金额判断门槛，A 限用一次，C 仅自动任务且在 A 满减后计算。
describe("REQ-A/B/C: 原始优惠边界（金额单位：分）", () => {
  it.each([
    [98999, "WEB", 0, 10000, 108999],
    [99000, "WEB", 0, 0, 99000],
    [99999, "WEB", 0, 0, 99999],
    [100000, "WEB", 10000, 0, 90000],
    [50000, "AI", 2500, 10000, 57500],
    [99000, "AI", 4950, 0, 94050],
    [100000, "AI", 14500, 0, 85500],
    [100001, "AI", 14500, 0, 85501],
  ] as const)("小计%s，来源%s", (subtotalMinor, source, discountMinor, shippingMinor, totalMinor) => {
    const quote = calculateBestQuote({ subtotalMinor, source, aiSubtotalMinor: source === "AI" ? subtotalMinor : 0, aiOrderEligible: source === "AI" });
    expect(quote.selected).toMatchObject({ discountMinor, shippingMinor, totalMinor });
  });
  it("A 用过后不再减免，B 在后续订单仍持续免运", () => {
    const quote = calculateBestQuote({ subtotalMinor: 100000, source: "WEB", promotionAAvailable: false });
    expect(quote.selected).toMatchObject({ id: "B", discountMinor: 0, shippingMinor: 0, totalMinor: 100000 });
  });
  it("手动提交即使购物车来源为 AI，也不享受 C", () => {
    const quote = calculateBestQuote({ subtotalMinor: 100000, source: "AI", aiSubtotalMinor: 100000, aiOrderEligible: false });
    expect(quote.selected).toMatchObject({ id: "A+B", discountMinor: 10000, totalMinor: 90000 });
  });
  it("A 用过后 AI 自动订单仍享受 B/C", () => {
    const quote = calculateBestQuote({ subtotalMinor: 100000, source: "AI", aiSubtotalMinor: 100000, aiOrderEligible: true, promotionAAvailable: false });
    expect(quote.selected).toMatchObject({ id: "B+C", discountMinor: 5000, shippingMinor: 0, totalMinor: 95000 });
  });
  it("AI 来源没有服务端自动任务资格时默认不授予 C", () => {
    expect(calculateBestQuote({ subtotalMinor: 50000, source: "AI", aiSubtotalMinor: 50000 }).selected.id).toBe("B");
  });
});
