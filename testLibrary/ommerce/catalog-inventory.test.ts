import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("@/lib/repository/db", () => ({
  getDbPool: () => ({ query }),
}));

import { getCatalogProduct, searchCatalogProducts } from "@/lib/catalog";

afterEach(() => query.mockReset());

describe("catalog inventory", () => {
  it("reads currently available stock from inventory_skus", async () => {
    query.mockResolvedValueOnce([[
      {
        product_id: "desk-kit",
        name: "Desk Kit",
        brand: "Test",
        category: "Office",
        category_id: "office",
        tone: "neutral",
        description: "Desk kit",
        price: 100,
        currency: "TWD",
        stock: 3,
        margin_rate: 0.2,
        internal_rank: 1,
        specs: null,
        rating: null,
        review_count: 0,
      },
    ]]);

    const product = await getCatalogProduct("desk-kit");

    expect(product?.stock).toBe(3);
    expect(query.mock.calls[0][0]).toContain("COALESCE(inv.on_hand - inv.reserved, 0) AS stock");
    expect(query.mock.calls[0][0]).toContain("LEFT JOIN inventory_skus inv ON inv.product_id = p.product_id");
  });

  it("filters in-stock results using available inventory", async () => {
    query.mockResolvedValueOnce([[]]);

    await searchCatalogProducts(
      { keywords: [], inStockOnly: true },
      20,
    );

    expect(query.mock.calls[0][0]).toContain("COALESCE(inv.on_hand - inv.reserved, 0) > 0");
  });
});
