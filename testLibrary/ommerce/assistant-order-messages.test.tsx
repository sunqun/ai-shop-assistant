import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistant } from "@/app/assistant/use-assistant";
import { AssistantMessages } from "@/app/assistant/assistant-messages";
import type { ShoppingTask } from "@/lib/shop-task/shopping-task-types";
import type { ReviewAnalysisReport } from "@/lib/reviews/types";
import { product } from "../intent/fixtures";

const mocks = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn(), active: vi.fn(), action: vi.fn() }));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({ user: { userid: "fixture-order" }, loading: false }),
}));
vi.mock("@/app/assistant/api", () => ({
  sendAssistantMessageRequest: mocks.send,
  getShoppingTaskRequest: mocks.get,
  getActiveShoppingTaskRequest: mocks.active,
  shoppingTaskActionRequest: mocks.action,
}));

const report: ReviewAnalysisReport = {
  analysisId: "order-reviews", productId: product.id, productName: product.name,
  question: "查看评价", status: "complete", snapshotAt: "2026-11-22T00:00:00Z",
  updatedAt: "2026-11-22T00:00:01Z", total: 3, readCount: 3, analyzedCount: 3,
  complete: true, ratingCounts: { "5": 3 }, positives: [], negatives: [], mixed: [],
  limitations: [], canContinue: false, reused: false,
};
const waiting: ShoppingTask = {
  taskId: "order-task", query: "找蓝牙耳机", phase: "awaiting_confirmation", revision: 2,
  commitAfter: null, canCancel: true, canConfirm: true, canAdvance: false,
  canRecover: false, terminal: false, product, quantity: 1,
  quote: {
    quote: {
      quoteId: "order-quote", cartId: "cart", cartVersion: 2, currency: "TWD",
      subtotalMinor: 50000, discountMinor: 2500, shippingMinor: 0, totalDueMinor: 47500,
      promotion: "C", label: "fixture", ruleVersion: "fixture", expiresAt: "2099-01-01T00:00:00Z",
    },
    appliedRules: [],
  },
};
const reviewed: ShoppingTask = { ...waiting, revision: 3, reviewHold: true, reviewAnalysis: report };
const ordered: ShoppingTask = {
  ...reviewed, phase: "ordered", revision: 5, terminal: true, canConfirm: false,
  canCancel: false, reviewHold: false,
  order: {
    orderGroupId: "fixture-order-group", orders: [], source: "AI",
    audit: { provenance: "assistant", userId: "fixture-order" },
  },
};
const reviewReply = "已完成当前商品本次范围内 3 条公开评论的分析。";

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  sessionStorage.clear();
  mocks.active.mockResolvedValue({ success: true, data: { task: null } });
  mocks.send.mockResolvedValueOnce({ success: true, data: { task: waiting } })
    .mockResolvedValueOnce({ success: true, data: { task: reviewed, reply: reviewReply, reviewAnalysis: report, pauseTask: true } });
  mocks.action.mockResolvedValue({ success: true, data: { task: ordered } });
  mocks.get.mockResolvedValue({ success: true, data: { task: ordered } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function start() {
  const hook = renderHook(useAssistant);
  await act(async () => {});
  await act(async () => { await hook.result.current.send(waiting.query); });
  await act(async () => { await hook.result.current.send("查看评价"); });
  return hook;
}

describe("订单结果的对话时间顺序（模拟 HTTP，不访问模型或数据库）", () => {
  it.each(["button", "message"])("评论后通过 %s 确认，订单追加在评论和本次确认之后", async (entry) => {
    const { result } = await start();
    const before = result.current.messages;
    mocks.send.mockResolvedValueOnce({ success: true, data: { task: ordered, reply: "订单已提交。" } });
    await act(async () => {
      if (entry === "button") await result.current.confirmOrder();
      else await result.current.send("确认下单");
    });
    const messages = result.current.messages;
    expect(messages.slice(0, before.length)).toEqual(before);
    const orderIndex = messages.findIndex((message) => message.result?.status === "ordered");
    expect(orderIndex).toBeGreaterThan(messages.findIndex((message) => message.reviewAnalysis));
    if (entry === "message") {
      expect(orderIndex).toBeGreaterThan(messages.findIndex((message) => message.text === "确认下单"));
      expect(mocks.send).toHaveBeenLastCalledWith("确认下单", expect.any(String), reviewed);
      expect(mocks.action).not.toHaveBeenCalled();
    } else {
      expect(mocks.action).toHaveBeenCalledExactlyOnceWith(waiting.taskId, "confirm", {
        quoteId: "order-quote", cartVersion: 2,
      });
    }
    expect(messages.filter((message) => message.result?.order)).toHaveLength(1);
    expect(messages.filter((message) => message.result?.quote)).toHaveLength(1);
    render(<AssistantMessages {...result.current} />);
    const review = screen.getByText(reviewReply);
    const order = screen.getByText("订单编号：fixture-order-group");
    expect(review.compareDocumentPosition(order) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("后续对话和重复刷新不移动、重复订单消息，旧 revision 也不会回退状态", async () => {
    const { result } = await start();
    await act(async () => { await result.current.confirmOrder(); });
    const orderIndex = result.current.messages.findIndex((message) => message.taskEvent === "order");
    mocks.send.mockResolvedValueOnce({ success: true, data: { task: ordered, reply: "当前订单已提交。" } });
    await act(async () => { await result.current.send("查询进度"); });
    const count = result.current.messages.length;
    mocks.get.mockResolvedValueOnce({ success: true, data: { task: ordered } })
      .mockResolvedValueOnce({ success: true, data: { task: { ...ordered, revision: 6 } } })
      .mockResolvedValueOnce({ success: true, data: { task: reviewed } });
    for (let i = 0; i < 3; i++) await act(async () => { await result.current.refreshTask(); });
    expect(result.current.messages).toHaveLength(count);
    expect(result.current.messages[orderIndex]?.result?.order?.orderGroupId).toBe("fixture-order-group");
    expect(result.current.messages.filter((message) => message.result?.order)).toHaveLength(1);
    expect(result.current.task?.revision).toBe(6);
    expect(result.current.messages.at(-1)?.text).toBe("当前订单已提交。");
  });

  it("确认响应不确定时，通过原任务核对出的订单仍追加在评论后", async () => {
    const { result } = await start();
    mocks.action.mockResolvedValueOnce({ success: false, errorMsg: "请求暂时中断" });
    await act(async () => { await result.current.confirmOrder(); });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(waiting.taskId);
    expect(result.current.messages.at(-1)?.result?.order?.orderGroupId).toBe("fixture-order-group");
    expect(result.current.messages.filter((message) => message.result?.order)).toHaveLength(1);
    expect(mocks.action).toHaveBeenCalledTimes(1);
  });

  it("自动下单也追加结果，不覆盖原始报价", async () => {
    const ready: ShoppingTask = {
      ...waiting, phase: "ready_to_order", canAdvance: true, canConfirm: false,
      commitAfter: new Date(Date.now() + 3000).toISOString(),
    };
    mocks.send.mockReset().mockResolvedValueOnce({ success: true, data: { task: ready, resumeTask: true } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => { await result.current.send(waiting.query); });
    const before = result.current.messages;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.messages.slice(0, before.length)).toEqual(before);
    expect(result.current.messages.at(-1)?.result?.order?.orderGroupId).toBe("fixture-order-group");
    expect(mocks.action).toHaveBeenCalledExactlyOnceWith(waiting.taskId, "advance", undefined);
  });

  it.each(["cached", "active"])("%s 恢复时按商品报价、评论、订单展示，刷新不重复", async (source) => {
    if (source === "cached") sessionStorage.setItem("assistant-task:fixture-order", ordered.taskId);
    else mocks.active.mockResolvedValue({ success: true, data: { task: ordered } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    const messages = result.current.messages;
    const quoteIndex = messages.findIndex((message) => message.result?.quote);
    const reviewIndex = messages.findIndex((message) => message.reviewAnalysis);
    const orderIndex = messages.findIndex((message) => message.result?.order);
    expect(quoteIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeGreaterThan(quoteIndex);
    expect(orderIndex).toBeGreaterThan(reviewIndex);
    await act(async () => { await result.current.refreshTask(); });
    expect(result.current.messages).toEqual(messages);
    expect(mocks.action).not.toHaveBeenCalled();
  });
});
