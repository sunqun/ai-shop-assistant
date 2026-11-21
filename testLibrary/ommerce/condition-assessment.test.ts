import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct, ProductSearchIntent } from "@/lib/catalog/types";
import { assessCatalogConditions } from "@/lib/catalog/condition-assessment";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/llm", () => ({ createLLMFromEnv: () => ({ invoke: mocks.invoke }) }));
const product: CatalogProduct = {
  id: "generic-product",
  name: "旅行背包",
  brand: "Fixture",
  category: "旅行用品",
  categoryId: "travel",
  tone: "neutral",
  price: 100,
  currency: "TWD",
  stock: 1,
  rating: 4,
  reviewCount: 1,
  description: "防潑水面料，適合短途出行。",
  specs: { 重量: "900g", 材質: "尼龍" },
};
const intent = (overrides: Partial<ProductSearchIntent>): ProductSearchIntent => ({
  keywords: ["背包"],
  inStockOnly: false,
  ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks();
});

describe("evidence-grounded generic conditions", () => {
  it("resolves a new synonym or script difference using a quoted catalog fact", async () => {
    mocks.invoke.mockResolvedValue({
      toolResult: {
        assessments: [
          {
            productId: product.id,
            conditionId: "required:0",
            verdict: "matched",
            evidence: "防潑水面料",
          },
        ],
      },
    });
    const result = await assessCatalogConditions(
      [product],
      intent({ requiredConditions: ["防泼水"] })
    );
    expect(result).toMatchObject([{ product, unresolved: [], unresolvedRequired: [], unresolvedPreferences: [] }]);
  });
  it("does not treat missing product information as a match", async () => {
    mocks.invoke.mockResolvedValue({
      toolResult: {
        assessments: [
          { productId: product.id, conditionId: "required:0", verdict: "unknown", evidence: "" },
        ],
      },
    });
    expect(
      await assessCatalogConditions([product], intent({ requiredConditions: ["可机洗"] }))
    ).toMatchObject([{ product, unresolved: ["可机洗"], unresolvedRequired: ["可机洗"] }]);
  });
  it("rejects fabricated evidence even if the model claims a match", async () => {
    mocks.invoke.mockResolvedValue({
      toolResult: {
        assessments: [
          {
            productId: product.id,
            conditionId: "required:0",
            verdict: "matched",
            evidence: "可放洗衣机清洗",
          },
        ],
      },
    });
    expect(
      (await assessCatalogConditions([product], intent({ requiredConditions: ["可机洗"] })))[0]
        .unresolved
    ).toEqual(["可机洗"]);
  });
  it("does not relax a requirement when the assessment model is unavailable", async () => {
    mocks.invoke.mockRejectedValue(new Error("model unavailable"));
    expect(
      (await assessCatalogConditions([product], intent({ requiredConditions: ["可机洗"] })))[0]
        .unresolved
    ).toEqual(["可机洗"]);
  });
  it("keeps an unfulfilled preference as a clarification instead of excluding the product", async () => {
    mocks.invoke.mockResolvedValue({
      toolResult: {
        assessments: [
          { productId: product.id, conditionId: "preference:0", verdict: "unknown", evidence: "" },
        ],
      },
    });
    expect(
      await assessCatalogConditions([product], intent({ preferences: ["适合长途旅行"] }))
    ).toMatchObject([{ product, unresolved: ["适合长途旅行"], unresolvedRequired: [], unresolvedPreferences: ["适合长途旅行"] }]);
  });
  it("cannot clear server-side unresolved numeric conditions", async () => {
    expect(
      await assessCatalogConditions([product], intent({ unresolvedConditions: ["数值未核实"] }))
    ).toMatchObject([{ product, unresolved: ["数值未核实"], unresolvedRequired: ["数值未核实"] }]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
