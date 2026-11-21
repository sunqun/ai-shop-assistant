// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "@/lib/shop-task/shopping-task-store";
import type { ShoppingTaskData } from "@/lib/shop-task/shopping-task-types";
import type { ShoppingPreparationControl } from "@/lib/agent/auto-shopping";
import { TERMINAL_PHASES } from "@/lib/shop-task/shopping-task-types";
import { dialogue, intent, product } from "../intent/fixtures";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  prepare: vi.fn(),
  order: vi.fn(),
  link: vi.fn(),
  records: [] as TaskRecord[],
}));
vi.mock("@/lib/intent/model-parser", () => ({ parseModelIntent: mocks.parse }));
vi.mock("@/lib/agent/auto-shopping", () => ({
  runShoppingReAct: mocks.prepare,
}));
vi.mock("@/lib/reviews/analysis-service", () => ({
  analyzeCurrentProductReviews: vi.fn(),
}));
vi.mock("@/lib/repository/payment-link-service", () => ({
  createPaymentLink: mocks.link,
}));
vi.mock("@/lib/repository/order-service", async (original) => ({
  ...(await original<object>()),
  submitAiOrder: mocks.order,
}));
vi.mock("@/lib/repository/db", () => ({
  getDbPool: () => ({
    query: async (sql: string) => [
      sql.includes("SELECT is_authorized") ? [{ is_authorized: 1 }] : [],
    ],
  }),
}));
vi.mock("@/lib/shop-task/shopping-task-store", async (original) => {
  const store =
    await original<typeof import("@/lib/shop-task/shopping-task-store")>();
  const find = (userid: string, taskId: string) => {
    const record = mocks.records.find(
      (item) => item.userid === userid && item.taskId === taskId,
    );
    if (!record)
      throw new store.ShoppingTaskError(
        "TASK_NOT_FOUND",
        "购物任务不存在。",
        404,
      );
    return record;
  };
  return {
    ...store,
    getActiveTask: async (userid: string) =>
      mocks.records.find((item) => item.activeUser === userid) ?? null,
    getTask: async (userid: string, taskId: string) => find(userid, taskId),
    createTask: async (input: Parameters<typeof store.createTask>[0]) => {
      const record: TaskRecord = {
        taskId: `task-${mocks.records.length + 1}`,
        userid: input.userid,
        query: input.query,
        phase: "queued",
        revision: 0,
        data: input.data ?? {},
        commitAfter: null,
        operationToken: null,
        operationStartedAt: null,
        activeUser: input.userid,
      };
      mocks.records.push(record);
      return record;
    },
    updateTask: async (
      userid: string,
      taskId: string,
      mutate: (record: TaskRecord) => void,
    ) => {
      const record = find(userid, taskId);
      mutate(record);
      record.revision += 1;
      if (TERMINAL_PHASES.includes(record.phase)) record.activeUser = null;
      return record;
    },
  };
});

import { handleAssistantMessage } from "@/lib/agent/dialogue-agent";
import { actOnShoppingTask } from "@/lib/shop-task/shopping-task-service";
import { OrderServiceError } from "@/lib/repository/order-service";

const candidate = {
  ...product,
  id: "aero-headphones",
  name: "Aero 無線藍牙耳機",
  price: 1890,
};
const quote: NonNullable<ShoppingTaskData["quote"]> = {
  quote: {
    quoteId: "headphones-quote",
    cartId: "headphones-cart",
    cartVersion: 2,
    currency: "TWD",
    subtotalMinor: 189000,
    discountMinor: 0,
    shippingMinor: 0,
    totalDueMinor: 189000,
    promotion: "none",
    label: "fixture",
    ruleVersion: "fixture",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  },
  appliedRules: [],
};
const input = { userid: "fixture-user", idempotencyKey: "search-key" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.records = [];
  mocks.link.mockResolvedValue({ urlToken: "canceled-product-link" });
});

describe("unified conversation order flow", () => {
  const difference = {
    requirement: "续航至少10小时",
    actual: "单次续航6小时",
    status: "not_met" as const,
  };
  function preparation(differences: ShoppingTaskData["differences"] = []) {
    mocks.parse.mockResolvedValue({
      intent: intent({ keywords: ["蓝牙耳机"] }),
      decision: { action: "new_search", confidence: 1 },
    });
    mocks.prepare.mockImplementation(
      async ({ control }: { control: ShoppingPreparationControl }) => {
        await control.onProgress({
          product: candidate,
          quantity: 1,
          quote,
          differences,
          dialogue: dialogue(),
        });
        return { status: "ready_for_confirmation", message: "报价就绪" };
      },
    );
    mocks.order.mockResolvedValue({
      orderGroupId: "headphones-order",
      orders: [],
    });
  }
  async function prepare(differences: ShoppingTaskData["differences"] = []) {
    preparation(differences);
    const initial = await handleAssistantMessage({
      ...input,
      query: "找一个蓝牙耳机",
    });
    return actOnShoppingTask(input.userid, initial.task!.taskId, "advance");
  }
  it("automatically submits an exact match after the server deadline without asking for confirmation", async () => {
    const prepared = await prepare();
    expect(prepared).toMatchObject({
      phase: "ready_to_order",
      canConfirm: false,
      quantity: 1,
      differences: [],
    });
    await actOnShoppingTask(input.userid, prepared.taskId, "advance");
    expect(mocks.order).not.toHaveBeenCalled();
    mocks.records[0].commitAfter = new Date(Date.now() - 1).toISOString();
    expect(
      await actOnShoppingTask(input.userid, prepared.taskId, "advance"),
    ).toMatchObject({ phase: "ordered" });
    expect(mocks.order).toHaveBeenCalledExactlyOnceWith({
      userid: input.userid,
      quoteId: quote.quote.quoteId,
      cartVersion: quote.quote.cartVersion,
      idempotencyKey: "shopping:" + prepared.taskId + ":order",
    });
  });
  it.each(["帮我下单", "幫我下單", "确认下单", "就这款"])(
    "%s accepts the disclosed difference and directly submits the displayed quote",
    async (query) => {
      const prepared = await prepare([difference]);
      expect(prepared).toMatchObject({
        phase: "awaiting_confirmation",
        differences: [difference],
        canConfirm: true,
        commitAfter: null,
      });
      await actOnShoppingTask(input.userid, prepared.taskId, "advance");
      expect(mocks.order).not.toHaveBeenCalled();
      const confirmed = await handleAssistantMessage({
        ...input,
        query,
        taskId: prepared.taskId,
        quote: {
          quoteId: quote.quote.quoteId,
          cartVersion: quote.quote.cartVersion,
        },
      });
      expect(confirmed.task).toMatchObject({
        phase: "ordered",
        terminal: true,
        acceptedQuote: {
          quoteId: quote.quote.quoteId,
          productId: candidate.id,
          quantity: 1,
          differences: [difference],
        },
      });
      expect(mocks.records).toHaveLength(1);
      expect(mocks.parse).toHaveBeenCalledTimes(1);
      expect(mocks.order).toHaveBeenCalledTimes(1);
    },
  );
  it.each([undefined, { quoteId: "stale", cartVersion: 1 }])(
    "does not accept a missing or stale displayed quote: %j",
    async (confirmation) => {
      const prepared = await prepare([difference]);
      const result = await handleAssistantMessage({
        ...input,
        query: "帮我下单",
        taskId: prepared.taskId,
        quote: confirmation,
      });
      expect(result.reply).toContain("核对最新报价");
      expect(mocks.order).not.toHaveBeenCalled();
      expect(mocks.records[0].data.acceptedQuote).toBeUndefined();
    },
  );
  it("canceling the difference confirmation generates a short link instead of submitting", async () => {
    const prepared = await prepare([difference]);
    const result = await handleAssistantMessage({
      ...input,
      query: "取消下单",
      taskId: prepared.taskId,
    });
    expect(result.task).toMatchObject({
      phase: "canceled",
      link: { urlToken: "canceled-product-link" },
    });
    expect(mocks.order).not.toHaveBeenCalled();
  });
  it("repeated confirmation does not submit a second order", async () => {
    const prepared = await prepare([difference]);
    const confirmation = {
      quoteId: quote.quote.quoteId,
      cartVersion: quote.quote.cartVersion,
    };
    await actOnShoppingTask(
      input.userid,
      prepared.taskId,
      "confirm",
      confirmation,
    );
    await actOnShoppingTask(
      input.userid,
      prepared.taskId,
      "confirm",
      confirmation,
    );
    expect(mocks.order).toHaveBeenCalledTimes(1);
  });
  it("stops when inventory cannot fulfill an accepted alternative", async () => {
    const prepared = await prepare([difference]);
    mocks.order.mockRejectedValueOnce(new OrderServiceError("OUT_OF_STOCK"));
    const result = await actOnShoppingTask(
      input.userid,
      prepared.taskId,
      "confirm",
      {
        quoteId: quote.quote.quoteId,
        cartVersion: quote.quote.cartVersion,
      },
    );
    expect(result).toMatchObject({
      phase: "failed",
      errorCode: "OUT_OF_STOCK",
      terminal: true,
    });
    expect(result.error).toContain("库存不足");
    expect(mocks.order).toHaveBeenCalledTimes(1);
  });
  it("recovers an uncertain accepted order with the same task and idempotency key", async () => {
    const prepared = await prepare([difference]);
    mocks.order.mockRejectedValueOnce(
      new Error("connection lost after submission"),
    );
    const result = await actOnShoppingTask(
      input.userid,
      prepared.taskId,
      "confirm",
      {
        quoteId: quote.quote.quoteId,
        cartVersion: quote.quote.cartVersion,
      },
    );
    expect(result).toMatchObject({
      phase: "reconciling_result",
      canRecover: true,
    });
    expect(
      await actOnShoppingTask(input.userid, prepared.taskId, "recover"),
    ).toMatchObject({ phase: "ordered" });
    expect(mocks.order.mock.calls[0][0]).toEqual(mocks.order.mock.calls[1][0]);
    expect(mocks.records).toHaveLength(1);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });
  it("does not recover by submitting a product or difference that was never accepted", async () => {
    const prepared = await prepare([difference]);
    mocks.order.mockRejectedValueOnce(new Error("submission result uncertain"));
    await actOnShoppingTask(input.userid, prepared.taskId, "confirm", {
      quoteId: quote.quote.quoteId, cartVersion: quote.quote.cartVersion,
    });
    mocks.records[0].data.differences = [{ ...difference, actual: "单次续航3小时" }];
    await expect(actOnShoppingTask(input.userid, prepared.taskId, "recover")).rejects.toMatchObject({
      code: "DIFFERENCE_ACCEPTANCE_REQUIRED",
    });
    expect(mocks.order).toHaveBeenCalledTimes(1);
  });
});
