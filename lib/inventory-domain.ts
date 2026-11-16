export type CartRequestLine = {
  skuId: string;
  quantity: number;
};

export type StockBalance = {
  onHand: number;
  reserved: number;
};

export type CartAllocation = CartRequestLine & {
  allocatedQuantity: number;
  unavailableQuantity: number;
};

export function normalizeCartLines(value: unknown): CartRequestLine[] {
  if (!Array.isArray(value)) throw new Error("INVALID_CART_ITEMS");

  const merged = new Map<string, number>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new Error("INVALID_CART_ITEMS");
    const line = entry as { skuId?: unknown; quantity?: unknown };
    if (
      typeof line.skuId !== "string" ||
      !line.skuId.trim() ||
      !Number.isSafeInteger(line.quantity) ||
      (line.quantity as number) < 1
    ) {
      throw new Error("INVALID_CART_ITEMS");
    }

    const next = (merged.get(line.skuId) ?? 0) + (line.quantity as number);
    if (!Number.isSafeInteger(next) || next > 2_147_483_647) throw new Error("INVALID_CART_ITEMS");
    merged.set(line.skuId, next);
  }

  return [...merged.entries()]
    .map(([skuId, quantity]) => ({ skuId, quantity }))
    .sort((left, right) => left.skuId.localeCompare(right.skuId));
}

export function allocateCartLines(
  lines: CartRequestLine[],
  balances: ReadonlyMap<string, StockBalance>
): CartAllocation[] {
  return [...lines]
    .sort((left, right) => left.skuId.localeCompare(right.skuId))
    .map(({ skuId, quantity }) => {
      const balance = balances.get(skuId);
      if (!balance || !Number.isSafeInteger(balance.onHand) || !Number.isSafeInteger(balance.reserved)) {
        throw new Error("INVENTORY_UNAVAILABLE");
      }

      const available = Math.max(0, balance.onHand - balance.reserved);
      const allocatedQuantity = Math.min(quantity, available);
      return {
        skuId,
        quantity,
        allocatedQuantity,
        unavailableQuantity: quantity - allocatedQuantity,
      };
    });
}

