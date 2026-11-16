import { describe, expect, it } from "vitest";
import { allocateCartLines, normalizeCartLines } from "@/lib/inventory-domain";
import { calculateBestQuote, lineSubtotalMinor, toMinor } from "@/lib/pricing-domain";

describe("inventory domain", () => {
  it("normalizes and merges duplicate cart lines", () => {
    expect(
      normalizeCartLines([
        { skuId: "b", quantity: 2 },
        { skuId: "a", quantity: 1 },
        { skuId: "b", quantity: 3 },
      ])
    ).toEqual([
      { skuId: "a", quantity: 1 },
      { skuId: "b", quantity: 5 },
    ]);
  });

  it("allocates only available stock and reports the shortfall", () => {
    expect(
      allocateCartLines(
        [
          { skuId: "a", quantity: 1 },
          { skuId: "b", quantity: 5 },
        ],
        new Map([
          ["a", { onHand: 1, reserved: 0 }],
          ["b", { onHand: 4, reserved: 2 }],
        ])
      )
    ).toEqual([
      { skuId: "a", quantity: 1, allocatedQuantity: 1, unavailableQuantity: 0 },
      { skuId: "b", quantity: 5, allocatedQuantity: 2, unavailableQuantity: 3 },
    ]);
  });

  it("treats fully-reserved stock as unavailable", () => {
    expect(
      allocateCartLines(
        [{ skuId: "sold-out", quantity: 2 }],
        new Map([["sold-out", { onHand: 2, reserved: 2 }]])
      )[0]
    ).toEqual({
      skuId: "sold-out",
      quantity: 2,
      allocatedQuantity: 0,
      unavailableQuantity: 2,
    });
  });

  it("rejects missing inventory and invalid lines", () => {
    expect(() =>
      allocateCartLines([{ skuId: "missing", quantity: 1 }], new Map())
    ).toThrow("INVENTORY_UNAVAILABLE");
    expect(() => normalizeCartLines([{ skuId: "", quantity: 1 }])).toThrow("INVALID_CART_ITEMS");
  });
});

describe("pricing domain", () => {
  it("converts price to minor units with round-half-up", () => {
    expect(toMinor(480)).toBe(48000);
    expect(toMinor(99.9)).toBe(9990);
    expect(toMinor(1.01)).toBe(101);
  });

  it("computes a line subtotal from unit price and quantity", () => {
    expect(lineSubtotalMinor(480, 2)).toBe(96000);
    expect(lineSubtotalMinor(99.9, 3)).toBe(29970);
  });

  it("charges shipping below the free-shipping threshold", () => {
    const quote = calculateBestQuote({ subtotalMinor: 98900, source: "WEB" });
    expect(quote.selected.id).toBe("B");
    expect(quote.selected.totalMinor).toBe(108900);
  });

  it("waives shipping at the threshold", () => {
    const quote = calculateBestQuote({ subtotalMinor: 99000, source: "WEB" });
    expect(quote.selected.id).toBe("B");
    expect(quote.selected.totalMinor).toBe(99000);
  });

  it("applies the A discount above NT$1,000", () => {
    const quote = calculateBestQuote({ subtotalMinor: 100000, source: "WEB" });
    expect(quote.selected.id).toBe("A+B");
    expect(quote.selected.totalMinor).toBe(90000);
  });

  it("applies the C discount for the AI source", () => {
    const quote = calculateBestQuote({ subtotalMinor: 50000, aiSubtotalMinor: 50000, source: "AI" });
    expect(quote.selected.id).toBe("B+C");
    expect(quote.selected.discountMinor).toBe(2500);
    expect(quote.selected.totalMinor).toBe(57500);
  });

  it("rejects invalid pricing input", () => {
    expect(() =>
      calculateBestQuote({ subtotalMinor: Number.MAX_SAFE_INTEGER + 1, source: "WEB" })
    ).toThrow("INVALID_PRICING_INPUT");
    expect(() =>
      calculateBestQuote({ subtotalMinor: 1000, aiSubtotalMinor: 1001, source: "AI" })
    ).toThrow("INVALID_PRICING_INPUT");
  });

  it("exposes a stable rule version and candidates", () => {
    const quote = calculateBestQuote({ subtotalMinor: 50000, aiSubtotalMinor: 50000, source: "AI" });
    expect(quote.candidates.map((candidate) => candidate.id)).toEqual(["B+C"]);
    expect(quote.ruleVersion).toBe("m3-2026-11-16-v2");
  });
});
