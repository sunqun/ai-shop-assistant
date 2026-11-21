// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductRow } from "@/lib/catalog/shared";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/repository/db", () => ({ getDbPool: () => ({ query: mocks.query }) }));
import { listProductPage } from "@/lib/catalog/products";
const row = (index: number): ProductRow => ({
  product_id: `fixture-${String(index).padStart(3, "0")}`, name: `商品${index}`, brand: "Fixture",
  category: "配件", category_id: "accessories", tone: "neutral", description: "测试",
  price: 100, currency: "TWD", stock: 3, margin_rate: 0.4, internal_rank: 100,
  specs: null, rating: 4, review_count: 0,
} as ProductRow);
beforeEach(() => { vi.resetAllMocks(); });
describe("BUG-F01: 网页目录真实分页", () => {
  it("首批100件后可用游标读取第101件，不暴露内部推荐分", async () => {
    mocks.query.mockResolvedValueOnce([Array.from({ length: 101 }, (_, index) => row(index + 1))])
      .mockResolvedValueOnce([[row(101)]]);
    const first = await listProductPage({}, 100);
    expect(first.products).toHaveLength(100);
    const cursor = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8"));
    expect(cursor.productId).toBe("fixture-100");
    expect(cursor).not.toHaveProperty("internal_rank");
    const second = await listProductPage({}, 100, first.nextCursor!);
    expect(second.products.map((product) => product.id)).toEqual(["fixture-101"]);
    expect(second.nextCursor).toBeNull();
    expect(mocks.query.mock.calls[1][1]).toEqual(["fixture-100", "fixture-100", "fixture-100", 101]);
  });
  it.each(["price-low", "price-high", "rating", "recommended"] as const)("排序%s作用于服务端完整结果，页内同分按ID", async (sort) => {
    mocks.query.mockResolvedValue([[]]);
    await listProductPage({ sort, categoryId: "accessories", keyword: "耳机" }, 20);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain("p.product_id ASC LIMIT ?");
    expect(params).toEqual(["accessories", "%耳机%", 21]);
    if (sort.startsWith("price")) expect(sql).toContain(`ORDER BY p.price ${sort === "price-low" ? "ASC" : "DESC"}`);
    if (sort === "rating") expect(sql).toContain("ORDER BY COALESCE(ROUND(AVG(r.rating), 1), 0) DESC");
  });
  it("筛选或排序改变不能复用旧游标", async () => {
    mocks.query.mockResolvedValue([[row(1), row(2)]]);
    const page = await listProductPage({ keyword: "耳机" }, 1);
    await expect(listProductPage({ keyword: "咖啡" }, 1, page.nextCursor!)).rejects.toThrow("INVALID_PRODUCT_CURSOR");
    await expect(listProductPage({ keyword: "耳机", sort: "price-low" }, 1, page.nextCursor!)).rejects.toThrow("INVALID_PRODUCT_CURSOR");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it.each([0, 101, 1.5])("非法pageSize=%s不查询", async (size) => {
    await expect(listProductPage({}, size)).rejects.toThrow("INVALID_PAGE_SIZE");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
