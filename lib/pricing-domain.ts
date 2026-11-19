export type AppliedPromotion = "A+B" | "B" | "A+B+C" | "B+C";
export type PricingCandidate = {
  id: AppliedPromotion;
  discountMinor: number;
  shippingMinor: number;
  totalMinor: number;
  label: string;
};
export type PricingInput = {
  subtotalMinor: number;
  source: "WEB" | "AI";
  aiSubtotalMinor?: number;
};

export function toMinor(price: number): number {
  // 统一“元 → 最小货币单位（分）”的舍入口径：四舍五入到分，避免各处使用不同取整方式造成 1 分误差。
  return Math.round(price * 100);
}

export function lineSubtotalMinor(price: number, quantity: number): number {
  // 商品行小计 = 单价(分) × 数量，与报价小计共用同一份实现。
  return toMinor(price) * quantity;
}

export function calculateBestQuote(input: PricingInput): {
  selected: PricingCandidate;
  candidates: PricingCandidate[];
  appliedRules: string[];
  ruleVersion: string;
} {
  const subtotal = input.subtotalMinor;
  const aiSubtotal = input.aiSubtotalMinor ?? 0;
  if (
    !Number.isSafeInteger(subtotal) ||
    subtotal < 0 ||
    !Number.isSafeInteger(aiSubtotal) ||
    aiSubtotal < 0 ||
    aiSubtotal > subtotal ||
    (input.source === "WEB" && aiSubtotal !== 0)
  )
    throw new Error("INVALID_PRICING_INPUT");
  const hasA = subtotal >= 100000;
  const freeShipping = subtotal >= 99000;
  const shippingMinor = freeShipping ? 0 : 10000;
  const discountA = hasA ? 10000 : 0;
  const discountC = input.source === "AI" ? Math.round(aiSubtotal * 0.05) : 0;
  const id: AppliedPromotion =
    input.source === "AI" ? (hasA ? "A+B+C" : "B+C") : hasA ? "A+B" : "B";
  const appliedRules = [
    hasA ? "A：商品金额满 NT$1,000 减 NT$100" : null,
    "B：商品金额满 NT$990 免运费，否则运费 NT$100",
    input.source === "AI" ? "C：AI 商品金额额外 95 折" : null,
  ].filter((label): label is string => Boolean(label));
  const selected = {
    id,
    discountMinor: discountA + discountC,
    shippingMinor,
    totalMinor: subtotal - discountA - discountC + shippingMinor,
    label: appliedRules.join("；"),
  };
  return { selected, candidates: [selected], appliedRules, ruleVersion: "m3-2026-11-16-v2" };
}
