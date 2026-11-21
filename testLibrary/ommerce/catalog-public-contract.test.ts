// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internalRankExpr, mapProduct, type ProductRow } from "@/lib/catalog/shared";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/repository/db", () => ({ getDbPool: () => ({ query: mocks.query }) }));
import { readProductReviewSnapshot } from "@/lib/catalog/reviews";

beforeEach(() => { vi.resetAllMocks(); });
describe("REQ-7: 目录公开契约", () => {
  it("服务端排序使用高毛利加权表达式", () => {
    expect(internalRankExpr("p")).toContain("recommendation_score");
    expect(internalRankExpr("p")).toContain("1.5");
  });
  it("公开商品不含毛利、推荐分或内部排序权重", () => {
    const output = mapProduct({
      product_id: "fixture", name: "Fixture", brand: "Fixture", category: "配件",
      category_id: "accessories", tone: "neutral", description: "测试", price: "100",
      currency: "TWD", stock: 2, margin_rate: 0.8, internal_rank: 150, specs: null,
      rating: null, review_count: 0,
    } as ProductRow);
    expect(Object.keys(output).sort()).toEqual([
      "id", "name", "brand", "category", "categoryId", "tone", "description", "price",
      "currency", "stock", "specs", "rating", "reviewCount",
    ].sort());
  });
});
describe("REQ-8: 评论快照原文读取（模拟数据库）", () => {
  const row = (id: string) => ({ review_id: id, reviewer_name: "测试用户", rating: 4,
    content: "联系 me@example.test，电话0912345678。地址：测试街道100号。好用。", reviewed_at: "2026-11-20" });
  it("分页保留起始快照上界，可读完全部评论且统一脱敏", async () => {
    mocks.query.mockResolvedValueOnce([[{ total: 3, max_id: "3" }]])
      .mockResolvedValueOnce([[row("3"), row("2"), row("1")]])
      .mockResolvedValueOnce([[{ total: 3, max_id: "3" }]])
      .mockResolvedValueOnce([[row("1")]]);
    const first = await readProductReviewSnapshot("fixture-product", 2);
    expect(first.reviews.map((review) => review.id)).toEqual(["3", "2"]);
    expect(first.nextCursor).not.toBeNull();
    expect(first.reviews[0].reviewer).toBe("测**");
    expect(first.reviews[0].content).not.toContain("me@example.test");
    expect(first.reviews[0].content).not.toContain("0912345678");
    expect(first.reviews[0].content).not.toContain("测试街道");
    const second = await readProductReviewSnapshot("fixture-product", 2, first.nextCursor!);
    expect(second.snapshot).toEqual(first.snapshot);
    expect(second.reviews.map((review) => review.id)).toEqual(["1"]);
    expect(second.nextCursor).toBeNull();
    expect(mocks.query.mock.calls[3][1]).toEqual(["fixture-product", "3", "2", 3]);
  });
  it("不能把商品A的评论游标用于商品B", async () => {
    mocks.query.mockResolvedValueOnce([[{ total: 1, max_id: "1" }]])
      .mockResolvedValueOnce([[row("1")]]);
    const page = await readProductReviewSnapshot("product-a", 1);
    await expect(readProductReviewSnapshot("product-b", 1, page.startCursor)).rejects.toThrow("Invalid review cursor");
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it("无评论时明确返回空快照且不伪造分析", async () => {
    mocks.query.mockResolvedValueOnce([[{ total: 0, max_id: "0" }]]).mockResolvedValueOnce([[]]);
    expect(await readProductReviewSnapshot("empty", 20)).toMatchObject({ reviews: [], nextCursor: null, snapshot: { total: 0, maxReviewId: "0" } });
  });
});
