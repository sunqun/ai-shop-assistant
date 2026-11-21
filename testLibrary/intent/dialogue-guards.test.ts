import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingTask } from "@/lib/shop-task/shopping-task-types";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), active: vi.fn(), get: vi.fn(), create: vi.fn(), act: vi.fn(), reviews: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/intent", async (original) => ({ ...(await original<object>()), resolveAssistantIntent: mocks.resolve }));
vi.mock("@/lib/shop-task/shopping-task-store", () => ({ getActiveTask: mocks.active, getTask: mocks.get, taskView: (record: unknown) => record, updateTask: mocks.update }));
vi.mock("@/lib/shop-task/shopping-task-service", () => ({ createShoppingTask: mocks.create, actOnShoppingTask: mocks.act }));
vi.mock("@/lib/reviews/analysis-service", () => ({ analyzeCurrentProductReviews: mocks.reviews }));
import { handleAssistantMessage } from "@/lib/agent/dialogue-agent";
import { dialogue, intent, product, routing } from "./fixtures";

const quote = { quoteId: "quote-a", cartVersion: 2 };
const input = { userid: "fixture-user", query: "确认下单", mode: "manual" as const, idempotencyKey: "key-a", taskId: "task-a", quote };
function task(patch: Partial<ShoppingTask> = {}): ShoppingTask {
  return { taskId: "task-a", query: "找充电宝", mode: "manual", phase: "awaiting_confirmation",
    revision: 1, commitAfter: null, canCancel: true, canConfirm: true, canAdvance: false,
    canRecover: false, terminal: false, product, dialogue: dialogue(),
    quote: { quote, appliedRules: [] } as unknown as ShoppingTask["quote"], ...patch };
}
beforeEach(() => { vi.resetAllMocks(); mocks.active.mockResolvedValue(task()); });
describe("INT-GUARD: 动作分类与实际交易隔离", () => {
  it.each(["llm", "state"] as const)("%s 分类确认下单不能执行交易", async (engine) => {
    mocks.resolve.mockResolvedValue({ intent: intent(), routing: routing({ action: "confirm_order", engine }) });
    const result = await handleAssistantMessage(input);
    expect(result.reply).toContain("没有执行交易");
    expect(mocks.act).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["llm", "state"] as const)("%s 分类取消不能执行交易", async (engine) => {
    mocks.resolve.mockResolvedValue({ intent: intent(), routing: routing({ action: "cancel_task", engine }) });
    await handleAssistantMessage({ ...input, query: "是不是取消了" });
    expect(mocks.act).not.toHaveBeenCalled();
  });
  it("精确确认仍需匹配当前展示的报价", async () => {
    mocks.resolve.mockResolvedValue({ intent: intent(), routing: routing({ action: "confirm_order", engine: "rules", reason: "exact_command" }) });
    await handleAssistantMessage({ ...input, quote: { ...quote, cartVersion: 1 } });
    expect(mocks.act).not.toHaveBeenCalled();
    mocks.act.mockResolvedValue(task({ phase: "ordered" }));
    await handleAssistantMessage(input);
    expect(mocks.act).toHaveBeenCalledExactlyOnceWith(input.userid, "task-a", "confirm", quote);
  });
  it("缺 taskId 不能确认当前任务", async () => {
    mocks.resolve.mockResolvedValue({ intent: intent(), routing: routing({ action: "confirm_order", engine: "rules", reason: "exact_command" }) });
    await handleAssistantMessage({ ...input, taskId: undefined });
    expect(mocks.act).not.toHaveBeenCalled();
  });
  it("旧任务消息不能操作新的活动任务", async () => {
    mocks.get.mockResolvedValue(task({ taskId: "old-task" }));
    expect((await handleAssistantMessage({ ...input, taskId: "old-task" })).routing.reason).toBe("active_task_changed");
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.act).not.toHaveBeenCalled();
  });
  it("有活动任务时不以新搜索暗中替换", async () => {
    mocks.resolve.mockResolvedValue({ intent: intent(), routing: routing() });
    expect((await handleAssistantMessage(input)).routing.reason).toBe("active_task_blocks_replacement");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("没有活动任务的有效搜索只创建一次任务", async () => {
    mocks.active.mockResolvedValue(null);
    mocks.resolve.mockResolvedValue({ intent: intent(), routing: routing() });
    mocks.create.mockResolvedValue(task({ phase: "queued" }));
    expect((await handleAssistantMessage({ ...input, taskId: undefined })).resumeTask).toBe(true);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.act).not.toHaveBeenCalled();
  });
  it("无商品的评论请求只引导澄清，不建单", async () => {
    mocks.active.mockResolvedValue(task({ product: undefined }));
    mocks.resolve.mockResolvedValue({ intent: intent(), routing: routing({ action: "analyze_reviews" }) });
    expect((await handleAssistantMessage(input)).pauseTask).toBe(true);
    expect(mocks.reviews).not.toHaveBeenCalled();
    expect(mocks.act).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("精确取消只委托状态机", async () => {
    mocks.resolve.mockResolvedValue({ intent: intent(), routing: routing({ action: "cancel_task", engine: "rules", reason: "exact_command" }) });
    mocks.act.mockResolvedValue(task({ phase: "canceled" }));
    await handleAssistantMessage({ ...input, query: "取消下单" });
    expect(mocks.act).toHaveBeenCalledExactlyOnceWith(input.userid, "task-a", "cancel");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("多件购买数量随完整意图传入任务", async () => {
    mocks.active.mockResolvedValue(null);
    mocks.resolve.mockResolvedValue({ intent: intent({ quantity: 3 }), routing: routing() });
    mocks.create.mockResolvedValue(task({ phase: "queued", quantity: 3 }));
    await handleAssistantMessage({ ...input, query: "买3个充电宝", taskId: undefined });
    expect(mocks.create.mock.calls[0][0].dialogue.intent.quantity).toBe(3);
  });
});
