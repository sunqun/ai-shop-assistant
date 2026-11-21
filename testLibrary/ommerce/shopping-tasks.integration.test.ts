// @vitest-environment node
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDbPool } from "@/lib/repository/db";
import { createShoppingTask, actOnShoppingTask } from "@/lib/shop-task/shopping-task-service";
import {
  assertNotTaskQuote,
  getTask,
  updateTask,
  getActiveTask,
  taskView,
} from "@/lib/shop-task/shopping-task-store";
import type { ShoppingPreparationControl } from "@/lib/agent/auto-shopping";
import type { CatalogProduct } from "@/lib/catalog";
import type { QuoteToolOutput } from "@/lib/mcp/types";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), order: vi.fn(), link: vi.fn() }));
vi.mock("@/lib/agent/auto-shopping", () => ({ runShoppingReAct: mocks.prepare }));
vi.mock("@/lib/repository/order-service", async (original) => ({
  ...(await original<object>()),
  submitAiOrder: mocks.order,
}));
vi.mock("@/lib/repository/payment-link-service", () => ({ createPaymentLink: mocks.link }));

const userid = randomUUID();
const product = {
  id: "task-fixture",
  name: "Fixture",
  price: 10,
  currency: "TWD",
  stock: 3,
} as CatalogProduct;
const quote: QuoteToolOutput = {
  quote: {
    quoteId: randomUUID(),
    cartId: "fixture-cart",
    cartVersion: 1,
    currency: "TWD",
    subtotalMinor: 1000,
    discountMinor: 0,
    shippingMinor: 0,
    totalDueMinor: 1000,
    promotion: "none",
    label: "fixture",
    ruleVersion: "fixture",
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  },
  appliedRules: [],
};
const order = {
  orderGroupId: "fixture-order",
  source: "AI",
  orders: [],
  audit: { provenance: "assistant", userId: userid },
};

// 显式开启才连接本地数据库；业务工具全部 mock，不创建真实订单、不预留真实库存。
describe.runIf(process.env.SHOPPING_TASK_DB_TEST === "1")(
  "shopping tasks with real MySQL row locks",
  () => {
    beforeAll(async () => {
      loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
      await getDbPool().execute(
        "INSERT INTO users (userid, username, password_hash, is_authorized) VALUES (?, ?, 'not-a-login-hash', TRUE)",
        [userid, `task-test-${userid}`]
      );
    });
    beforeEach(async () => {
      await getDbPool().execute("DELETE FROM shopping_tasks WHERE userid = ?", [userid]);
      vi.clearAllMocks();
      mocks.link.mockResolvedValue({ urlToken: "fixture-link" });
      mocks.order.mockResolvedValue(order);
      mocks.prepare.mockImplementation(
        async ({ control }: { control: ShoppingPreparationControl }) => {
          await control.beforeTool("searching");
          await control.onProgress({ product });
          await control.beforeTool("quoting");
          await control.onProgress({ quote });
        }
      );
    });
    afterAll(async () => {
      if (globalThis.aiShopDbPool) {
        await getDbPool().execute("DELETE FROM shopping_tasks WHERE userid = ?", [userid]);
        await getDbPool().execute("DELETE FROM users WHERE userid = ?", [userid]);
        await getDbPool().end();
        globalThis.aiShopDbPool = undefined;
      }
    });

    async function start() {
      return createShoppingTask({ userid, query: "fixture", idempotencyKey: randomUUID() });
    }
    async function ready(needsConfirmation = false) {
      const task = await start();
      if (needsConfirmation) await updateTask(userid, task.taskId, (current) => {
        current.data.differences = [{ requirement: "预算100元以内", actual: "商品189元", status: "not_met" }];
      });
      await actOnShoppingTask(userid, task.taskId, "advance");
      if (!needsConfirmation)
        await updateTask(userid, task.taskId, (current) => {
          current.commitAfter = new Date(Date.now() - 1).toISOString();
        });
      return task;
    }

    it("deduplicates creation and rejects changed payloads and overlapping tasks", async () => {
      const input = {
        userid,
        query: "fixture",

        idempotencyKey: randomUUID(),
      };
      const first = await createShoppingTask(input);
      expect((await createShoppingTask(input)).taskId).toBe(first.taskId);
      await expect(createShoppingTask({ ...input, query: "changed" })).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_REUSED",
      });
      await expect(start()).rejects.toMatchObject({ code: "ACTIVE_TASK_EXISTS" });
      await expect(getTask(randomUUID(), first.taskId)).rejects.toMatchObject({
        code: "TASK_NOT_FOUND",
      });
    });

    it("keeps disclosed product differences awaiting explicit acceptance and validates the quote", async () => {
      const task = await ready(true);
      expect((await actOnShoppingTask(userid, task.taskId, "advance")).phase).toBe(
        "awaiting_confirmation"
      );
      expect(mocks.order).not.toHaveBeenCalled();
      await expect(
        actOnShoppingTask(userid, task.taskId, "confirm", { quoteId: randomUUID(), cartVersion: 1 })
      ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
      const result = await actOnShoppingTask(userid, task.taskId, "confirm", {
        quoteId: quote.quote.quoteId,
        cartVersion: 1,
      });
      expect(result.phase).toBe("ordered");
      expect(result.order).toEqual(order);
      await actOnShoppingTask(userid, task.taskId, "confirm", {
        quoteId: quote.quote.quoteId,
        cartVersion: 1,
      });
      expect(mocks.order).toHaveBeenCalledTimes(1);
    });

    it("does not auto-submit until the server deadline, then submits without confirmation", async () => {
      const task = await start();
      const prepared = await actOnShoppingTask(userid, task.taskId, "advance");
      expect(prepared.phase).toBe("ready_to_order");
      expect(Date.parse(prepared.commitAfter!) - Date.now()).toBeGreaterThan(2000);
      await actOnShoppingTask(userid, task.taskId, "advance");
      expect(mocks.order).not.toHaveBeenCalled();
      await updateTask(userid, task.taskId, (current) => {
        current.commitAfter = new Date(Date.now() - 1).toISOString();
      });
      expect((await actOnShoppingTask(userid, task.taskId, "advance")).phase).toBe("ordered");
      expect(mocks.order).toHaveBeenCalledTimes(1);
    });

    it("cancels before any product exists without inventing a link", async () => {
      const task = await start();
      const canceled = await actOnShoppingTask(userid, task.taskId, "cancel");
      expect(canceled.phase).toBe("canceled_no_product");
      await actOnShoppingTask(userid, task.taskId, "advance");
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.order).not.toHaveBeenCalled();
      expect(mocks.link).not.toHaveBeenCalled();
    });

    it("accepts cancellation during search and uses its result only for handoff", async () => {
      let releaseSearch!: () => void;
      let entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const searchGate = new Promise<void>((resolve) => {
        releaseSearch = resolve;
      });
      mocks.prepare.mockImplementation(
        async ({ control }: { control: ShoppingPreparationControl }) => {
          await control.beforeTool("searching");
          entered();
          await searchGate;
          await control.onProgress({ product });
          await control.beforeTool("reconciling");
          throw new Error("Must never reach business mutation after cancellation");
        }
      );
      const task = await start();
      const running = actOnShoppingTask(userid, task.taskId, "advance");
      await enteredPromise;
      expect((await actOnShoppingTask(userid, task.taskId, "cancel")).phase).toBe("cancel_pending");
      releaseSearch();
      expect((await running).phase).toBe("canceled");
      expect(mocks.order).not.toHaveBeenCalled();
      expect(mocks.link).toHaveBeenCalledWith({
        userid,
        productId: product.id,
        quantity: 1,
        linkId: task.taskId,
      });
    });

    it("makes cancellation and commit mutually exclusive under concurrent requests", async () => {
      for (let iteration = 0; iteration < 6; iteration++) {
        const task = await ready();
        const results = await Promise.allSettled([
          actOnShoppingTask(userid, task.taskId, iteration % 2 ? "advance" : "cancel"),
          actOnShoppingTask(userid, task.taskId, iteration % 2 ? "cancel" : "advance"),
        ]);
        expect(results.some((result) => result.status === "fulfilled")).toBe(true);
        const final = await getTask(userid, task.taskId);
        expect(["canceled", "ordered"]).toContain(final.phase);
        expect(mocks.order.mock.calls.length + mocks.link.mock.calls.length).toBe(iteration + 1);
      }
    });

    it("hides cancellation before invoking the order service and rejects late cancellation", async () => {
      let finish!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      mocks.order.mockImplementation(async () => {
        entered();
        await gate;
        return order;
      });
      const task = await ready();
      const pending = actOnShoppingTask(userid, task.taskId, "advance");
      await started;
      expect(taskView(await getTask(userid, task.taskId))).toMatchObject({
        phase: "committing",
        canCancel: false,
      });
      await expect(actOnShoppingTask(userid, task.taskId, "cancel")).rejects.toMatchObject({
        code: "TASK_NOT_CANCELLABLE",
      });
      finish();
      await pending;
      expect(mocks.link).not.toHaveBeenCalled();
    });

    it("retries an uncertain order using exactly the original idempotency key", async () => {
      mocks.order.mockRejectedValueOnce(new Error("response lost"));
      const task = await ready();
      expect((await actOnShoppingTask(userid, task.taskId, "advance")).phase).toBe(
        "reconciling_result"
      );
      expect((await actOnShoppingTask(userid, task.taskId, "recover")).phase).toBe("ordered");
      expect(mocks.order.mock.calls[0]![0]).toEqual(mocks.order.mock.calls[1]![0]);
      expect(mocks.link).not.toHaveBeenCalled();
    });

    it("retries failed links without resuming shopping or blocking a newer task", async () => {
      mocks.link.mockRejectedValueOnce(new Error("link error"));
      const task = await ready();
      expect((await actOnShoppingTask(userid, task.taskId, "cancel")).phase).toBe(
        "canceled_link_failed"
      );
      const newer = await start();
      expect((await actOnShoppingTask(userid, task.taskId, "retry-link")).phase).toBe("canceled");
      expect((await getActiveTask(userid))?.taskId).toBe(newer.taskId);
      expect(mocks.link.mock.calls[0]![0]).toEqual(mocks.link.mock.calls[1]![0]);
      expect(mocks.order).not.toHaveBeenCalled();
    });

    it("blocks legacy confirmations for task-owned quotes", async () => {
      await ready(true);
      await expect(assertNotTaskQuote(userid, quote.quote.quoteId)).rejects.toMatchObject({
        code: "TASK_CONFIRM_REQUIRED",
      });
    });

    it("does not replay abandoned preparation after the operation timeout", async () => {
      const task = await start();
      await updateTask(userid, task.taskId, (current) => {
        current.phase = "reconciling";
        current.operationToken = randomUUID();
        current.operationStartedAt = new Date(Date.now() - 130000).toISOString();
      });
      expect((await actOnShoppingTask(userid, task.taskId, "advance")).phase).toBe("failed");
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.order).not.toHaveBeenCalled();
    });

    it("enforces authorization before conversation task creation", async () => {
      await getDbPool().execute("UPDATE users SET is_authorized = FALSE WHERE userid = ?", [
        userid,
      ]);
      try {
        await expect(start()).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
        await expect(start()).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
      } finally {
        await getDbPool().execute("UPDATE users SET is_authorized = TRUE WHERE userid = ?", [
          userid,
        ]);
      }
    });
  }
);
