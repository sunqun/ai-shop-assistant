import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistant } from "@/app/assistant/use-assistant";
import { AssistantMessages } from "@/app/assistant/assistant-messages";
import type { ShoppingTask } from "@/lib/shop-task/shopping-task-types";
import type { ReviewAnalysisReport } from "@/lib/reviews/types";
import { product } from "../intent/fixtures";

const mocks = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn(), active: vi.fn(), action: vi.fn() }));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({ user: { userid: "fixture-cancellation" }, loading: false }),
}));
vi.mock("@/app/assistant/api", () => ({
  sendAssistantMessageRequest: mocks.send,
  getShoppingTaskRequest: mocks.get,
  getActiveShoppingTaskRequest: mocks.active,
  shoppingTaskActionRequest: mocks.action,
}));

const waiting: ShoppingTask = {
  taskId: "review-task", query: "找蓝牙耳机", phase: "awaiting_confirmation", revision: 2,
  commitAfter: null, canCancel: true, canConfirm: true, canAdvance: false,
  canRecover: false, terminal: false, product, quantity: 1,
  clarification: "请核对商品和报价。",
  quote: {
    quote: {
      quoteId: "shown-quote", cartId: "cart", cartVersion: 2, currency: "TWD",
      subtotalMinor: 50000, discountMinor: 2500, shippingMinor: 0, totalDueMinor: 47500,
      promotion: "C", label: "fixture", ruleVersion: "fixture", expiresAt: "2099-01-01T00:00:00Z",
    },
    appliedRules: [],
  },
};
const report: ReviewAnalysisReport = {
  analysisId: "review-analysis", productId: product.id, productName: product.name,
  question: "看看评论", status: "complete", snapshotAt: "2026-11-22T00:00:00Z",
  updatedAt: "2026-11-22T00:00:01Z", total: 3, readCount: 3, analyzedCount: 3,
  complete: true, ratingCounts: { "5": 3 }, positives: [], negatives: [], mixed: [],
  limitations: [], canContinue: false, reused: false,
};
const reviewed: ShoppingTask = { ...waiting, revision: 3, reviewHold: true, reviewAnalysis: report };
const canceled: ShoppingTask = {
  ...reviewed, revision: 6, phase: "canceled", terminal: true, canCancel: false,
  canConfirm: false, link: { urlToken: "fixture-token" },
};
const reviewReply = "已完成当前商品本次范围内 3 条公开评论的分析。";

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  sessionStorage.clear();
  mocks.active.mockResolvedValue({ success: true, data: { task: null } });
  mocks.send.mockResolvedValueOnce({ success: true, data: { task: waiting } })
    .mockResolvedValue({ success: true, data: { task: reviewed, reply: reviewReply, reviewAnalysis: report, pauseTask: true } });
  mocks.action.mockResolvedValue({ success: true, data: { task: canceled } });
  mocks.get.mockResolvedValue({ success: true, data: { task: canceled } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function start(withReviews = true) {
  const hook = renderHook(useAssistant);
  await act(async () => {});
  await act(async () => { await hook.result.current.send(waiting.query); });
  if (withReviews) await act(async () => { await hook.result.current.send("看看评论"); });
  return hook;
}

describe("取消短链消息的时间顺序（模拟 HTTP，不访问模型或数据库）", () => {
  it("评论后点击取消，保留原报价并在评论后显示取消结果和唯一短链", async () => {
    const { result } = await start();
    const before = result.current.messages;
    await act(async () => { await result.current.cancelToPaymentLink(); });
    const messages = result.current.messages;
    expect(messages.slice(0, before.length)).toEqual(before);
    expect(messages.at(-1)).toMatchObject({ text: "已取消直接下单，并生成支付短链", shortLink: expect.stringContaining("fixture-token") });
    expect(messages.at(-1)?.result).toBeUndefined();
    expect(messages.filter((message) => message.shortLink)).toHaveLength(1);
    expect(messages.filter((message) => message.result?.quote)).toHaveLength(1);
    expect(mocks.action).toHaveBeenCalledExactlyOnceWith(waiting.taskId, "cancel", undefined);
    render(<AssistantMessages {...result.current} />);
    const review = screen.getByText(reviewReply);
    const link = screen.getByRole("link", { name: /handoff\?token=fixture-token/ });
    expect(review.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("重复刷新和较新 revision 只更新同一取消消息，旧 revision 不能抹掉短链", async () => {
    const { result } = await start();
    await act(async () => { await result.current.cancelToPaymentLink(); });
    const count = result.current.messages.length;
    mocks.get.mockResolvedValueOnce({ success: true, data: { task: canceled } })
      .mockResolvedValueOnce({ success: true, data: { task: { ...canceled, revision: 7 } } })
      .mockResolvedValueOnce({ success: true, data: { task: reviewed } });
    for (let i = 0; i < 3; i++) await act(async () => { await result.current.refreshTask(); });
    expect(result.current.messages).toHaveLength(count);
    expect(result.current.messages.at(-1)?.shortLink).toContain("fixture-token");
    expect(result.current.task?.revision).toBe(7);
    expect(result.current.messages.filter((message) => message.shortLink)).toHaveLength(1);
  });

  it("取消处理中、短链失败和重试成功共用一条消息，始终位于评论之后", async () => {
    const pending: ShoppingTask = { ...canceled, revision: 4, phase: "cancel_pending", terminal: false, link: undefined };
    const creating: ShoppingTask = { ...pending, revision: 5, phase: "link_creating" };
    const failed: ShoppingTask = { ...pending, revision: 6, phase: "canceled_link_failed", terminal: true, error: "支付短链生成失败，请重试。" };
    mocks.action.mockResolvedValueOnce({ success: true, data: { task: pending } })
      .mockResolvedValueOnce({ success: true, data: { task: { ...canceled, revision: 7 } } });
    const { result } = await start();
    const before = result.current.messages.length;
    await act(async () => { await result.current.cancelToPaymentLink(); });
    expect(result.current.messages.at(-1)?.text).toBe("已接受取消，正在结束当前步骤");
    for (const task of [creating, failed]) {
      mocks.get.mockResolvedValueOnce({ success: true, data: { task } });
      await act(async () => { await result.current.refreshTask(); });
      expect(result.current.messages).toHaveLength(before + 1);
    }
    expect(result.current.messages.at(-1)?.text).toBe(failed.error);
    await act(async () => { await result.current.retryPaymentLink(); });
    expect(result.current.messages).toHaveLength(before + 1);
    expect(result.current.messages.at(-1)?.shortLink).toContain("fixture-token");
    expect(mocks.action).toHaveBeenLastCalledWith(waiting.taskId, "retry-link", undefined);
  });

  it("没有查看评论时，取消结果仍追加在商品报价之后", async () => {
    const { result } = await start(false);
    await act(async () => { await result.current.cancelToPaymentLink(); });
    expect(result.current.messages.at(-2)?.result?.quote).toBeDefined();
    expect(result.current.messages.at(-1)?.shortLink).toContain("fixture-token");
    expect(result.current.messages.at(-1)?.text).not.toBe(waiting.clarification);
  });

  it("取消待收尾时自动推进，成功响应仍更新同一条取消消息", async () => {
    const pending: ShoppingTask = {
      ...canceled, phase: "cancel_pending", revision: 4, terminal: false,
      canAdvance: true, link: undefined,
    };
    mocks.action.mockResolvedValueOnce({ success: true, data: { task: pending } })
      .mockResolvedValueOnce({ success: true, data: { task: canceled } });
    const { result } = await start();
    const before = result.current.messages.length;
    await act(async () => { await result.current.cancelToPaymentLink(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.action.mock.calls.map((call) => call[1])).toEqual(["cancel", "advance"]);
    expect(result.current.messages).toHaveLength(before + 1);
    expect(result.current.messages.at(-1)?.shortLink).toContain("fixture-token");
    expect(result.current.messages.filter((message) => message.reviewAnalysis)).toHaveLength(1);
  });

  it("没有可用商品的取消也在评论后说明结果，不伪造短链或额外商品卡片", async () => {
    mocks.action.mockResolvedValue({ success: true, data: { task: {
      ...canceled, phase: "canceled_no_product", product: undefined, quote: undefined, link: undefined,
    } } });
    const { result } = await start();
    const before = result.current.messages;
    await act(async () => { await result.current.cancelToPaymentLink(); });
    expect(result.current.messages.slice(0, before.length)).toEqual(before);
    expect(result.current.messages.at(-1)).toMatchObject({ text: "已取消；没有可用于生成短链的商品" });
    expect(result.current.messages.at(-1)?.shortLink).toBeUndefined();
    expect(result.current.messages.at(-1)?.result).toBeUndefined();
  });

  it("新任务的取消结果不会覆盖上一任务的短链", async () => {
    const { result } = await start();
    await act(async () => { await result.current.cancelToPaymentLink(); });
    const firstLink = result.current.messages.at(-1);
    const nextTask = { ...waiting, taskId: "next-task" };
    mocks.send.mockResolvedValueOnce({ success: true, data: { task: nextTask } });
    await act(async () => { await result.current.send("找另一款商品"); });
    mocks.action.mockResolvedValueOnce({ success: true, data: { task: {
      ...canceled, taskId: nextTask.taskId, link: { urlToken: "next-token" },
    } } });
    await act(async () => { await result.current.cancelToPaymentLink(); });
    expect(result.current.messages.filter((message) => message.shortLink)).toEqual([
      firstLink, expect.objectContaining({ taskId: nextTask.taskId, shortLink: expect.stringContaining("next-token") }),
    ]);
  });

  it.each(["cached", "active"])("%s 恢复含评论的取消任务时，商品、评论、取消结果按顺序显示", async (source) => {
    if (source === "cached") sessionStorage.setItem("assistant-task:fixture-cancellation", canceled.taskId);
    else mocks.active.mockResolvedValue({ success: true, data: { task: canceled } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    const messages = result.current.messages;
    const quoteIndex = messages.findIndex((message) => message.result?.quote);
    const reviewIndex = messages.findIndex((message) => message.reviewAnalysis);
    const linkIndex = messages.findIndex((message) => message.shortLink);
    expect(quoteIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeGreaterThan(quoteIndex);
    expect(linkIndex).toBeGreaterThan(reviewIndex);
    await act(async () => { await result.current.refreshTask(); });
    expect(result.current.messages).toHaveLength(messages.length);
    expect(result.current.messages.filter((message) => message.shortLink)).toHaveLength(1);
    expect(mocks.action).not.toHaveBeenCalled();
  });
});
