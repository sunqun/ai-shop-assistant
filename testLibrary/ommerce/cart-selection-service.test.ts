// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), products: vi.fn(), commit: vi.fn(), rollback: vi.fn() }));
vi.mock("@/lib/repository/db", () => ({ getDbPool: () => ({ getConnection: async () => ({
  query: mocks.query, execute: mocks.execute, beginTransaction: vi.fn(),
  commit: mocks.commit, rollback: mocks.rollback, release: vi.fn(),
}) }) }));
vi.mock("@/lib/catalog", () => ({ getCatalogProducts: mocks.products }));
import { quoteCart } from "@/lib/repository/quote-service";
import { submitWebOrder } from "@/lib/repository/order-service";
const userid = "00000000-0000-4000-8000-000000000001";
let selection: string[] | null;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_SESSION_SECRET", "fixture-secret-for-cart-id-only");
  selection = ["sku-a"];
  const future = new Date(Date.now() + 60000);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM order_groups")) return [[]];
    if (sql.includes("FROM users")) return [[{ userid, is_authorized: 1 }]];
    if (sql.includes("FROM carts")) return [[{ source: "WEB", cart_version: 1, expires_at: future }]];
    if (sql.includes("FROM cart_quotes")) return [[{ cart_version: 1, selected_sku_ids: JSON.stringify(selection), subtotal_minor: 10000, total_minor: 20000, promotion: "B", rule_version: "promotions-2026-11-21-v4", discount_minor: 0, shipping_minor: 10000, shopping_task_id: null, expires_at: future }]];
    if (sql.includes("FROM cart_items")) return [["a", "b"].map((id) => ({
      sku_id: `sku-${id}`, product_id: id, allocated_quantity: 1, unavailable_quantity: 0,
      reserved_quantity: 1, reservation_status: "ACTIVE", reservation_expires_at: future,
    }))];
    if (sql.includes("FROM inventory_reservations")) return [[{
      sku_id: "sku-a", reserved_quantity: 1, status: "ACTIVE", expires_at: future, on_hand: 10, reserved: 1,
    }]];
    throw new Error(`Unexpected query: ${sql}`);
  });
  mocks.execute.mockResolvedValue([{ affectedRows: 1 }]);
  mocks.products.mockResolvedValue(new Map([["a", { name: "A", price: 100 }], ["b", { name: "B", price: 200 }]]));
});
afterEach(() => vi.unstubAllEnvs());
describe("购物车勾选结算", () => {
  it("仅勾选商品参与小计与优惠计算，并保存报价范围", async () => {
    const result = await quoteCart({ userid, cartVersion: 1, expectedSource: "WEB", selectedSkuIds: ["sku-a"] });
    expect(result.quote.subtotalMinor).toBe(10000);
    expect(mocks.products).toHaveBeenCalledWith(["a"]);
    const insert = mocks.execute.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO cart_quotes"));
    expect(insert?.[1][10]).toBe('["sku-a"]');
  });
  it.each([[], ["missing"], ["sku-a", "sku-a"]].map((selectedSkuIds) => ({ selectedSkuIds })))("拒绝无效勾选 $selectedSkuIds", async ({ selectedSkuIds }) => {
    await expect(quoteCart({ userid, cartVersion: 1, expectedSource: "WEB", selectedSkuIds })).rejects.toMatchObject({ code: "INVALID_CART_SELECTION" });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("下单仅消费报价中勾选的商品，未勾选商品和库存预留保留", async () => {
    await submitWebOrder({ userid, cartVersion: 1, quoteId: "quote", idempotencyKey: "key" });
    const writes = mocks.execute.mock.calls;
    expect(writes.filter(([sql]) => sql.startsWith("INSERT INTO order_items"))).toHaveLength(1);
    expect(writes.find(([sql]) => sql.startsWith("INSERT INTO order_items"))?.[1][1]).toBe("sku-a");
    expect(writes.find(([sql]) => sql.startsWith("DELETE FROM cart_items"))?.[1].slice(1)).toEqual(["sku-a"]);
    expect(writes.filter(([sql]) => sql.includes("SET on_hand ="))).toHaveLength(1);
    expect(writes.find(([sql]) => sql.includes("SET on_hand ="))?.[1][2]).toBe("sku-a");
    expect(mocks.commit).toHaveBeenCalledOnce();
  });
  it("报价范围缺失商品时拒绝下单，不能改成整车结算", async () => {
    selection = ["missing"];
    await expect(submitWebOrder({ userid, cartVersion: 1, quoteId: "quote", idempotencyKey: "key" })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
