import { describe, expect, it } from "vitest";
import { getProduct, products } from "@/lib/products";

describe("products", () => {
  it("包含商品数据", () => {
    expect(products.length).toBeGreaterThan(0);
  });

  it("按 id 查找商品", () => {
    expect(getProduct("desk-kit")?.name).toBe("智能办公套装");
  });

  it("未知 id 返回 undefined", () => {
    expect(getProduct("not-exist")).toBeUndefined();
  });
});
