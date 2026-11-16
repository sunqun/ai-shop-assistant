export type AppliedPromotion = "A+B" | "B" | "A+B+C" | "B+C";
export type PricingCandidate = { id: AppliedPromotion; discountMinor: number; shippingMinor: number; totalMinor: number; label: string };
export type PricingInput = { subtotalMinor: number; source: "WEB" | "AI"; aiSubtotalMinor?: number };

export function calculateBestQuote(input: PricingInput): { selected: PricingCandidate; candidates: PricingCandidate[]; appliedRules: string[]; ruleVersion: string } {
  const subtotal = input.subtotalMinor;
  const aiSubtotal = input.aiSubtotalMinor ?? 0;
  if (!Number.isSafeInteger(subtotal) || subtotal < 0 || !Number.isSafeInteger(aiSubtotal) || aiSubtotal < 0 || aiSubtotal > subtotal || (input.source === "WEB" && aiSubtotal !== 0)) throw new Error("INVALID_PRICING_INPUT");
  const hasA = subtotal >= 100000;
  const freeShipping = subtotal >= 99000;
  const shippingMinor = freeShipping ? 0 : 10000;
  const discountA = hasA ? 10000 : 0;
  const discountC = input.source === "AI" ? Math.round(aiSubtotal * 0.05) : 0;
  const id: AppliedPromotion = input.source === "AI" ? (hasA ? "A+B+C" : "B+C") : (hasA ? "A+B" : "B");
  const appliedRules = [
    hasA ? "A：商品金额满 NT$1,000 减 NT$100" : null,
    "B：商品金额满 NT$990 免运费，否则运费 NT$100",
    input.source === "AI" ? "C：AI 商品金额额外 95 折（M4 自动下单适用）" : null,
  ].filter((label): label is string => Boolean(label));
  const selected = { id, discountMinor: discountA + discountC, shippingMinor, totalMinor: subtotal - discountA - discountC + shippingMinor, label: appliedRules.join("；") };
  return { selected, candidates: [selected], appliedRules, ruleVersion: "m3-2026-11-16-v2" };
}

