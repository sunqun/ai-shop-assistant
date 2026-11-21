// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  invoke: vi.fn(),
  batches: [] as Array<Array<Record<string, unknown>>>,
}));
vi.mock("@/lib/repository/db", () => ({
  getDbPool: () => ({ query: mocks.query }),
}));
vi.mock("@/lib/llm", () => ({
  createLLMFromEnv: () => ({ invoke: mocks.invoke }),
}));
import { searchShoppingProducts } from "@/lib/catalog/products";
import type { ProductSearchIntent } from "@/lib/catalog/types";

function row(patch: Record<string, unknown> = {}) {
  return {
    product_id: "rank-first",
    name: "蓝牙耳机",
    brand: "B",
    category: "配件",
    category_id: "accessories",
    tone: "neutral",
    description: "轻巧入耳式耳机",
    price: 1890,
    currency: "TWD",
    stock: 34,
    specs: { 续航: "6小时" },
    rating: 4.7,
    review_count: 3,
    margin_rate: 0.8,
    internal_rank: 999,
    ...patch,
  };
}
const request: ProductSearchIntent = {
  keywords: ["蓝牙耳机"],
  inStockOnly: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.batches = [];
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("FROM product_search_aliases")
      ? [[]]
      : [mocks.batches.shift() ?? []],
  );
  mocks.invoke.mockResolvedValue({ toolResult: { assessments: [] } });
});

describe("shopping candidate selection and disclosed differences", () => {
  it("prefers a complete match over a higher-ranked alternative", async () => {
    mocks.batches = [
      [
        row(),
        row({
          product_id: "exact",
          brand: "A",
          price: 1200,
          specs: { 续航: "12小时" },
        }),
      ],
    ];
    const result = await searchShoppingProducts({
      ...request,
      brand: "A",
      maxPrice: 1500,
      numericConstraints: [
        { attribute: "续航", operator: "gte", value: 10, unit: "小时" },
      ],
    });
    expect(result.products[0].id).toBe("exact");
    expect(result.differences).toEqual([]);
  });
  it("returns the highest-ranked same-subject alternative with budget, brand and battery differences", async () => {
    mocks.batches = [[row(), row({ product_id: "lower-ranked", price: 2000 })]];
    const result = await searchShoppingProducts({
      ...request,
      brand: "A",
      maxPrice: 1500,
      numericConstraints: [
        { attribute: "续航", operator: "gte", value: 10, unit: "小时" },
      ],
    });
    expect(result.products[0].id).toBe("rank-first");
    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: "品牌：A",
          actual: "品牌：B",
          status: "not_met",
        }),
        expect.objectContaining({
          requirement: "商品单价不超过 1500 TWD",
          status: "not_met",
        }),
        expect.objectContaining({
          requirement: "续航至少10小时",
          actual: "续航：6小时",
          status: "not_met",
        }),
      ]),
    );
    const sql = mocks.query.mock.calls.find(([text]) =>
      text.includes("FROM products"),
    )![0];
    expect(sql).toContain("ORDER BY internal_rank DESC, p.product_id ASC");
    const publicResult = JSON.stringify(result);
    for (const secret of [
      "margin_rate",
      "internal_rank",
      "recommendation_score",
    ])
      expect(publicResult).not.toContain(secret);
  });
  it("searches beyond the first batch for an exact match before settling for an alternative", async () => {
    mocks.batches = [
      Array.from({ length: 100 }, (_, i) =>
        row({ product_id: "candidate-" + i }),
      ),
      [row({ product_id: "exact-next-page", price: 1000 })],
    ];
    const result = await searchShoppingProducts({ ...request, maxPrice: 1500 });
    expect(result.products[0].id).toBe("exact-next-page");
    const queries = mocks.query.mock.calls.filter(([sql]) =>
      sql.includes("FROM products"),
    );
    expect(queries).toHaveLength(2);
    expect(queries[1][1]).toContain("candidate-99");
  });
  it("does not describe missing specifications as matched", async () => {
    mocks.batches = [[row({ specs: {} })]];
    const result = await searchShoppingProducts({
      ...request,
      numericConstraints: [
        { attribute: "续航", operator: "gte", value: 10, unit: "小时" },
      ],
    });
    expect(result.differences).toEqual([
      expect.objectContaining({ status: "unverified" }),
    ]);
  });
  it("does not confuse case-assisted battery duration with single-charge battery duration", async () => {
    mocks.batches = [[row({ specs: { 续航: "单次6小时，含充电盒24小时" } })]];
    const result = await searchShoppingProducts({
      ...request,
      numericConstraints: [
        { attribute: "续航", operator: "gte", value: 10, unit: "小时" },
      ],
    });
    expect(result.differences).toEqual([
      expect.objectContaining({ status: "unverified" }),
    ]);
  });
  it("retains a contradicted required condition as an explicitly disclosed alternative", async () => {
    mocks.batches = [[row({ specs: { 防水: "不支持" } })]];
    const result = await searchShoppingProducts({
      ...request,
      requiredConditions: ["防水"],
    });
    expect(result.products).toHaveLength(1);
    expect(result.differences).toEqual([
      expect.objectContaining({
        requirement: "防水",
        actual: "防水：不支持",
        status: "not_met",
      }),
    ]);
  });
  it("requires acceptance for unverifiable subjective preferences", async () => {
    mocks.batches = [[row()]];
    const result = await searchShoppingProducts({
      ...request,
      preferences: ["价格合适"],
    });
    expect(result.differences).toEqual([
      expect.objectContaining({
        requirement: "价格合适",
        status: "unverified",
      }),
    ]);
  });
  it("does not silently override exclusions", async () => {
    mocks.batches = [[row()]];
    const result = await searchShoppingProducts({
      ...request,
      excludeBrands: ["B"],
    });
    expect(result.differences).toEqual([
      expect.objectContaining({
        requirement: "排除品牌：B",
        status: "not_met",
      }),
    ]);
  });
  it("checks that the candidate can fulfill the full requested quantity", async () => {
    mocks.batches = [
      [row({ stock: 1 }), row({ product_id: "enough-stock", stock: 3 })],
    ];
    expect(
      (await searchShoppingProducts({ ...request, quantity: 2 })).products[0]
        .id,
    ).toBe("enough-stock");
  });
  it("returns no orderable candidate if all products are short of stock", async () => {
    mocks.batches = [[row({ stock: 1 })]];
    expect(
      (await searchShoppingProducts({ ...request, quantity: 2 })).products,
    ).toEqual([]);
  });
  it("does not broaden a brand-only request into unrelated product types", async () => {
    const result = await searchShoppingProducts({
      keywords: [],
      brand: "A",
      inStockOnly: true,
    });
    expect(result.products).toEqual([]);
    expect(result.clarification).toContain("商品类型");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("does not turn unresolved quantity evidence into consentable product differences", async () => {
    const result = await searchShoppingProducts({
      ...request,
      unresolvedConditions: ["购买数量范围不明确"],
    });
    expect(result.products).toEqual([]);
    expect(result.clarification).toContain("购买数量范围不明确");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
