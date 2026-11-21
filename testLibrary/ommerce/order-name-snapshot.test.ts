// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), products: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/repository/db", () => ({ getDbPool: () => ({ query: mocks.query, getConnection: async () => ({
  query: mocks.query, execute: mocks.execute, beginTransaction: mocks.begin,
  commit: mocks.commit, rollback: mocks.rollback, release: mocks.release,
}) }) }));
vi.mock("@/lib/catalog", () => ({ getCatalogProducts: mocks.products }));
import { listUserOrders, submitWebOrder, submitAiOrder } from "@/lib/repository/order-service";
const userid = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_SESSION_SECRET", "fixture-secret-for-cart-id-only"); });
afterEach(() => { vi.unstubAllEnvs(); });
describe("BUG-F02: 订单商品名称快照", () => {
  it("查询读取订单快照，不再依赖已改名/已下架的商品表", async () => {
    mocks.query.mockResolvedValue([[{
      order_group_id: "group", source: "WEB", created_at: "2026-11-20T00:00:00Z", subtotal_minor: 10000,
      discount_minor: 0, shipping_minor: 0, total_minor: 10000, order_id: "order", sku_id: "sku",
      quantity: 1, unit_price_minor: 10000, product_name: "下单时的耳机A",
    }]]);
    const orders = await listUserOrders(userid);
    expect(orders[0].items[0].productName).toBe("下单时的耳机A");
    expect(mocks.query.mock.calls[0][0]).toContain("oi.product_name_snapshot AS product_name");
    expect(mocks.query.mock.calls[0][0]).not.toContain("JOIN products");
    expect(mocks.query.mock.calls[0][1]).toEqual([userid]);
  });
  it("旧订单没有历史名称时明确标记，不冒充当前名称", async () => {
    mocks.query.mockResolvedValue([[{
      order_group_id: "group", source: "AI", created_at: "2026-11-20T00:00:00Z", subtotal_minor: 10000,
      discount_minor: 0, shipping_minor: 0, total_minor: 10000, order_id: "order", sku_id: "sku",
      quantity: 1, unit_price_minor: 10000, product_name: null,
    }]]);
    expect((await listUserOrders(userid))[0].items[0].productName).toBe("[历史商品名称未记录] sku");
  });
  it.each([
    ["AI", "task", "task"],
    ["AI", null, null],
    ["WEB", null, null],
    ["AI", undefined, null],
  ] as const)("订单展示区分计价来源%s与任务来源%s", async (source, shoppingTaskId, expected) => {
    mocks.query.mockResolvedValue([[{
      order_group_id: "group", source, shopping_task_id: shoppingTaskId,
      created_at: "2026-11-20T00:00:00Z", subtotal_minor: 10000,
      discount_minor: 500, shipping_minor: 0, total_minor: 9500,
      order_id: "order", sku_id: "sku", quantity: 1, unit_price_minor: 10000,
      product_name: "耳机",
    }]]);
    expect((await listUserOrders(userid))[0]).toMatchObject({
      source, shoppingTaskId: expected, discountMinor: 500, totalMinor: 9500,
    });
    const sql = mocks.query.mock.calls[0][0];
    expect(sql).toContain("st.userid = og.userid");
    expect(sql).toContain("q.shopping_task_id = st.task_id");
    expect(sql).toContain("og.idempotency_key = CONCAT('shopping:', st.task_id, ':order')");
  });
  it.each(["WEB", "AI"] as const)("%s建单在同一事务插入数量/单价/名称快照", async (source) => {
    const future = new Date(Date.now() + 60000);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM order_groups")) return [[]];
      if (sql.includes("FROM users")) return [[{ userid, is_authorized: 1 }]];
      if (sql.includes("FROM carts")) return [[{ cart_id: "cart", source, cart_version: 1, expires_at: future }]];
      if (sql.includes("FROM cart_quotes")) {
        const ai = source === "AI";
        return [[{ quote_id: "quote", cart_version: 1, subtotal_minor: 30000, total_minor: ai ? 38500 : 40000, promotion: ai ? "B+C" : "B", rule_version: "promotions-2026-11-21-v4", discount_minor: ai ? 1500 : 0, shipping_minor: 10000, shopping_task_id: null, expires_at: future, consumed_at: null }]];
      }
      if (sql.includes("FROM cart_items")) return [[{ sku_id: "sku", product_id: "product", allocated_quantity: 3, unavailable_quantity: 0 }]];
      if (sql.includes("FROM inventory_reservations")) return [[{ sku_id: "sku", reserved_quantity: 3, status: "ACTIVE", expires_at: future, on_hand: 10, reserved: 3 }]];
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.execute.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.products.mockResolvedValue(new Map([["product", { name: "创建时原名", price: 100 }]]));
    await (source === "WEB" ? submitWebOrder : submitAiOrder)({ userid, cartVersion: 1, quoteId: "quote", idempotencyKey: "key" });
    const write = mocks.execute.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO order_items"));
    expect(write?.[0]).toContain("product_name_snapshot");
    expect(write?.[1].slice(1)).toEqual(["sku", 3, 10000, "创建时原名"]);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });
});
