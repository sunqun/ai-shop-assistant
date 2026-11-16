import assert from "node:assert/strict";
import { allocateCartLines, normalizeCartLines } from "../lib/inventory-domain.ts";
import { calculateBestQuote } from "../lib/pricing-domain.ts";

function expectError(action: () => unknown, message: string) {
  assert.throws(action, (error: unknown) => error instanceof Error && error.message === message);
}

const normalized = normalizeCartLines([
  { skuId: "b", quantity: 2 },
  { skuId: "a", quantity: 1 },
  { skuId: "b", quantity: 3 },
]);
assert.deepEqual(normalized, [
  { skuId: "a", quantity: 1 },
  { skuId: "b", quantity: 5 },
]);

const partial = allocateCartLines(
  normalized,
  new Map([
    ["a", { onHand: 1, reserved: 0 }],
    ["b", { onHand: 4, reserved: 2 }],
  ])
);
assert.deepEqual(partial, [
  { skuId: "a", quantity: 1, allocatedQuantity: 1, unavailableQuantity: 0 },
  { skuId: "b", quantity: 5, allocatedQuantity: 2, unavailableQuantity: 3 },
]);

const allUnavailable = allocateCartLines(
  [{ skuId: "sold-out", quantity: 2 }],
  new Map([["sold-out", { onHand: 2, reserved: 2 }]])
);
assert.deepEqual(allUnavailable[0], {
  skuId: "sold-out",
  quantity: 2,
  allocatedQuantity: 0,
  unavailableQuantity: 2,
});
expectError(() => allocateCartLines([{ skuId: "missing", quantity: 1 }], new Map()), "INVENTORY_UNAVAILABLE");
expectError(() => normalizeCartLines([{ skuId: "", quantity: 1 }]), "INVALID_CART_ITEMS");

const at989 = calculateBestQuote({ subtotalMinor: 98900, source: "WEB" });
assert.equal(at989.selected.id, "B");
assert.equal(at989.selected.totalMinor, 108900);

const at990 = calculateBestQuote({ subtotalMinor: 99000, source: "WEB" });
assert.equal(at990.selected.id, "B");
assert.equal(at990.selected.totalMinor, 99000);

const at1000 = calculateBestQuote({ subtotalMinor: 100000, source: "WEB" });
assert.equal(at1000.selected.id, "A+B");
assert.equal(at1000.selected.totalMinor, 90000);

const aiQuote = calculateBestQuote({
  subtotalMinor: 50000,
  aiSubtotalMinor: 50000,
  source: "AI",
});
assert.equal(aiQuote.selected.id, "B+C");
assert.equal(aiQuote.selected.discountMinor, 2500);
assert.equal(aiQuote.selected.totalMinor, 57500);
expectError(
  () => calculateBestQuote({ subtotalMinor: Number.MAX_SAFE_INTEGER + 1, source: "WEB" }),
  "INVALID_PRICING_INPUT"
);
expectError(
  () => calculateBestQuote({ subtotalMinor: 1000, aiSubtotalMinor: 1001, source: "AI" }),
  "INVALID_PRICING_INPUT"
);

assert.deepEqual(aiQuote.candidates.map((candidate) => candidate.id), ["B+C"]);
assert.equal(aiQuote.ruleVersion, "m3-2026-11-16-v2");

console.log("M3 domain checks passed");
