import { describe, expect, it } from "vitest";
import { validatePurchaseQuantity } from "@/lib/intent/purchase-quantity";
import { mergeIntent } from "@/lib/intent/intent-utils";
import { intent } from "./fixtures";

describe("BUG-I04: 购买件数核实", () => {
  it.each([["买3个充电宝", 3], ["买两件耳机", 2], ["数量改成5台", 5]])("明确件数 %s", (query, quantity) => {
    expect(validatePurchaseQuantity(intent(), String(query)).quantity).toBe(quantity);
  });
  it.each(["买0个", "买100个", "买1.5个", "不要3个", "至少买3个", "买3个以上", "买3到5个", "买2个耳机和3个杯子"])("不将范围/否定/多组件数当明确数量 %s", (query) => {
    const result = validatePurchaseQuantity(intent(), query);
    expect(result.quantity).toBeUndefined();
    expect(result.unresolvedConditions?.length).toBeGreaterThan(0);
  });
  it("不从规格数字或模型编造值推测数量", () => {
    expect(validatePurchaseQuantity(intent(), "找20000mAh充电宝").quantity).toBeUndefined();
    expect(validatePurchaseQuantity(intent({ quantity: 3 }), "找充电宝").unresolvedConditions?.length).toBeGreaterThan(0);
  });
  it("不把商品3件套型号当成购买3份", () => {
    expect(validatePurchaseQuantity(intent(), "找旅行3件套").quantity).toBeUndefined();
  });
  it("不把连接设备数量当购买件数", () => {
    expect(validatePurchaseQuantity(intent(), "找可以同时给两台设备充电的充电宝").quantity).toBeUndefined();
    expect(validatePurchaseQuantity(intent(), "买可连接2台设备的耳机").quantity).toBeUndefined();
  });
  it("补充搜索继承未撤销的件数，新件数覆盖旧件数", () => {
    expect(mergeIntent(intent({ quantity: 3 }), intent()).quantity).toBe(3);
    expect(mergeIntent(intent({ quantity: 3 }), intent({ quantity: 2 })).quantity).toBe(2);
  });
});
