// 购物车请求中的单行条目：SKU 及请求数量。
export type CartRequestLine = {
  skuId: string;
  quantity: number;
};

// 某 SKU 的库存余额：在库数量与已预留数量。
export type StockBalance = {
  onHand: number;
  reserved: number;
};

// 购物车行在库存分配后的结果，附加可分配与不可分配数量。
export type CartAllocation = CartRequestLine & {
  allocatedQuantity: number;
  unavailableQuantity: number;
};

// 购物车条目归一化：
// 1. 校验入参必须是数组，且每条记录结构合法（skuId 非空字符串、quantity 为正安全整数）。
// 2. 将同一 SKU 的数量合并，并做溢出与上限校验。
// 3. 按 skuId 排序后返回，保证后续处理顺序稳定。
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

    // 累加同一 SKU 的请求数量，并校验累计结果不溢出且不超过 32 位整数上限。
    const next = (merged.get(line.skuId) ?? 0) + (line.quantity as number);
    if (!Number.isSafeInteger(next) || next > 2_147_483_647) throw new Error("INVALID_CART_ITEMS");
    merged.set(line.skuId, next);
  }

  return [...merged.entries()]
    .map(([skuId, quantity]) => ({ skuId, quantity }))
    .sort((left, right) => left.skuId.localeCompare(right.skuId));
}

// 根据库存余额为购物车行分配可售数量：
// 可用库存 = max(0, 在库 - 已预留)，分配量取请求量与可用库存的较小值，
// 差额计入不可分配数量；任一 SKU 缺少库存信息则抛错。
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

