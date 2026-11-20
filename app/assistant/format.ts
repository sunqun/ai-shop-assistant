export function formatMoney(value: unknown, currency?: string) {
  const amount = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(amount) && currency)
    return new Intl.NumberFormat("zh-TW", { style: "currency", currency }).format(amount);
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : "待核价";
}
