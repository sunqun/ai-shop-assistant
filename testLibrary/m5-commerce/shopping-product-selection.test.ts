import { describe, expect, it } from "vitest";
import { selectTopInStockProduct } from "@/lib/agent/shopping-react";

describe("shopping agent product selection", () => {
  it("preserves catalog ranking and skips out-of-stock products", () => {
    const products = [
      { id: "rank-1", stock: 0, price: 10 },
      { id: "rank-2", stock: 2, price: 100 },
      { id: "rank-3", stock: 4, price: 1 },
    ];

    expect(selectTopInStockProduct(products)?.id).toBe("rank-2");
  });

  it("returns undefined when no search result is in stock", () => {
    expect(selectTopInStockProduct([{ id: "out", stock: 0 }])).toBeUndefined();
  });
});
