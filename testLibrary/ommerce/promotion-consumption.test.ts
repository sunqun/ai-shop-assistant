// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), products: vi.fn(), commit: vi.fn(), rollback: vi.fn() }));
vi.mock("@/lib/repository/db", () => ({ getDbPool: () => ({ getConnection: async () => ({
  query: mocks.query, execute: mocks.execute, beginTransaction: vi.fn(), commit: mocks.commit, rollback: mocks.rollback, release: vi.fn(),
}) }) }));
vi.mock("@/lib/catalog", () => ({ getCatalogProducts: mocks.products }));
import { quoteCart } from "@/lib/repository/quote-service";
import { submitWebOrder, submitAiOrder } from "@/lib/repository/order-service";
import { PRICING_RULE_VERSION } from "@/lib/pricing-domain";
import { deriveUserCartId } from "@/lib/repository/cart-session";
const userid = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
let source: "WEB" | "AI";
let usedA: boolean;
let conversationTask: boolean;
let quoteRow: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_SESSION_SECRET", "fixture-secret-for-cart-id-only");
  source = "WEB"; usedA = false; conversationTask = false;
  const future = new Date(Date.now() + 60000);
  quoteRow = { quote_id: "quote", cart_version: 1, subtotal_minor: 100000, discount_minor: 10000,
    shipping_minor: 0, total_minor: 90000, promotion: "A+B", rule_version: PRICING_RULE_VERSION,
    shopping_task_id: null, consumed_at: null, expires_at: future };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM users")) return [[{ userid, is_authorized: 1 }]];
    if (sql.includes("FROM order_groups og")) return [usedA ? [{ order_group_id: "previous-order" }] : []];
    if (sql.includes("FROM order_groups")) return [[]];
    if (sql.includes("FROM shopping_tasks")) return [conversationTask ? [{ task_id: taskId }] : []];
    if (sql.includes("FROM carts")) return [[{ source, cart_version: 1, expires_at: future }]];
    if (sql.includes("FROM cart_quotes")) return [[quoteRow]];
    if (sql.includes("FROM cart_items")) return [[{ sku_id: "sku", product_id: "product", allocated_quantity: 1,
      unavailable_quantity: 0, reserved_quantity: 1, reservation_status: "ACTIVE", reservation_expires_at: future }]];
    if (sql.includes("FROM inventory_reservations")) return [[{ sku_id: "sku", reserved_quantity: 1,
      status: "ACTIVE", expires_at: future, on_hand: 10, reserved: 1 }]];
    throw new Error(`Unexpected query: ${sql}`);
  });
  mocks.execute.mockResolvedValue([{ affectedRows: 1 }]);
  mocks.products.mockResolvedValue(new Map([["product", { name: "商品", price: 1000 }]]));
});
afterEach(() => vi.unstubAllEnvs());
describe("优惠资格与事务核销", () => {
  it.each(["WEB", "AI"] as const)("%s 历史订单使用过 A 后，新报价不再使用 A，B 仍免运", async (cartSource) => {
    source = cartSource; usedA = true;
    const result = await quoteCart({ userid, cartVersion: 1, expectedSource: source });
    expect(result.quote).toMatchObject({ promotion: "B", discountMinor: 0, shippingMinor: 0, totalDueMinor: 100000 });
    expect(mocks.query.mock.calls.find(([sql]) => sql.includes("FROM order_groups og"))?.[1]).toEqual([userid]);
  });
  it("报价不核销 A，只保存报价；重复报价仍可预览 A", async () => {
    for (let i = 0; i < 2; i++) expect((await quoteCart({ userid, cartVersion: 1 })).quote.promotion).toBe("A+B");
    expect(mocks.execute.mock.calls.every(([sql]) => sql.startsWith("INSERT INTO cart_quotes"))).toBe(true);
  });
  it.each([undefined, taskId])("没有有效对话任务的 AI 来源报价 %s 不享受 C", async (shoppingTaskId) => {
    source = "AI";
    expect((await quoteCart({ userid, cartVersion: 1, expectedSource: source, shoppingTaskId })).quote).toMatchObject({ promotion: "A+B", totalDueMinor: 90000 });
  });
  it("服务端对话任务报价享受满减后 95 折，并绑定任务", async () => {
    source = "AI"; conversationTask = true;
    expect((await quoteCart({ userid, cartVersion: 1, expectedSource: source, shoppingTaskId: taskId })).quote).toMatchObject({ promotion: "A+B+C", totalDueMinor: 85500 });
    expect(mocks.execute.mock.calls[0][1].at(-1)).toBe(taskId);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("task_id = ? AND userid = ?"), [taskId, userid]);
  });
  it.each(["WEB", "AI"] as const)("%s 下单时发现 A 已被另一笔订单使用，拒绝旧报价并回滚", async (cartSource) => {
    source = cartSource; usedA = true;
    await expect((source === "WEB" ? submitWebOrder : submitAiOrder)({ userid, cartVersion: 1, quoteId: "quote", idempotencyKey: "key" })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalledOnce();
    const queries = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(queries.findIndex((sql) => sql.includes("FROM users") && sql.includes("FOR UPDATE"))).toBeLessThan(queries.findIndex((sql) => sql.includes("FROM order_groups og")));
  });
  it("对话任务报价不能在独立提交入口使用", async () => {
    source = "AI"; conversationTask = true;
    Object.assign(quoteRow, { shopping_task_id: taskId, promotion: "A+B+C", discount_minor: 14500, total_minor: 85500 });
    await expect(submitAiOrder({ userid, cartVersion: 1, quoteId: "quote", idempotencyKey: "independent-key" })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("对话任务下单再次验证 C 资格并成功核销报价", async () => {
    source = "AI"; conversationTask = true;
    Object.assign(quoteRow, { shopping_task_id: taskId, promotion: "A+B+C", discount_minor: 14500, total_minor: 85500 });
    await submitAiOrder({ userid, cartVersion: 1, quoteId: "quote", idempotencyKey: `shopping:${taskId}:order` });
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("SET consumed_at"), ["quote"]);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });
  it("成功使用 A 的订单保存与核销均处于同一事务，写入失败会整体回滚", async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("INSERT INTO order_items")) throw new Error("database interrupted");
      return [{ affectedRows: 1 }];
    });
    await expect(submitWebOrder({ userid, cartVersion: 1, quoteId: "quote", idempotencyKey: "key" })).rejects.toThrow("database interrupted");
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("旧计价规则的报价必须重新获取", async () => {
    quoteRow.rule_version = "m3-2026-11-16-v2";
    await expect(submitWebOrder({ userid, cartVersion: 1, quoteId: "quote", idempotencyKey: "key" })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("成功订单同键重试直接返回原结果，不再次核销 A 或消费库存", async () => {
    usedA = true;
    const response = { orderGroupId: "existing", source: "WEB", orders: [{ orderId: "order" }], audit: { provenance: "web", userId: userid } };
    mocks.query.mockResolvedValueOnce([[{ cart_id: deriveUserCartId(userid, "WEB"), cart_version: 1,
      quote_id: "quote", response_json: JSON.stringify(response) }]]);
    expect(await submitWebOrder({ userid, cartVersion: 1, quoteId: "quote", idempotencyKey: "key" })).toEqual(response);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
