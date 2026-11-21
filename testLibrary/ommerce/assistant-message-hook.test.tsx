import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingTask } from "@/lib/shop-task/shopping-task-types";
import { useAssistant } from "@/app/assistant/use-assistant";
import { product } from "../intent/fixtures";

const mocks = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn(), active: vi.fn(), action: vi.fn() }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({ user: { userid: "fixture-hook" }, loading: false }) }));
vi.mock("@/app/assistant/api", () => ({
  sendAssistantMessageRequest: mocks.send, getShoppingTaskRequest: mocks.get,
  getActiveShoppingTaskRequest: mocks.active, shoppingTaskActionRequest: mocks.action,
}));
const clarified: ShoppingTask = {
  taskId: "fixture-task", query: "大容量充电宝", phase: "needs_clarification",
  revision: 1, commitAfter: null, canCancel: false, canConfirm: false, canAdvance: false,
  canRecover: false, terminal: true, clarification: "最低容量是多少？", product,
};
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear();
  mocks.active.mockResolvedValue({ success: true, data: { task: null } });
});
afterEach(cleanup);
describe("INT-UI: 新消息入口及澄清交互", () => {
  it("通过 messages 入口发送，展示候选澄清并保持输入可用", async () => {
    mocks.send.mockResolvedValue({ success: true, data: { task: clarified, resumeTask: true } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => { await result.current.send("大容量充电宝"); });
    expect(mocks.send).toHaveBeenCalledWith("大容量充电宝", expect.any(String), null);
    expect(result.current.task?.phase).toBe("needs_clarification");
    expect(result.current.messages.at(-1)?.text).toBe(clarified.clarification);
    expect(result.current.messages.at(-1)?.result?.product?.id).toBe(product.id);
    expect(result.current.canSend).toBe(true);
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("纯对话回复不自动创建或推进交易", async () => {
    mocks.send.mockResolvedValue({ success: true, data: { task: null, reply: "请说明想找的商品" } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => { await result.current.send("你好"); });
    expect(result.current.messages.at(-1)?.text).toBe("请说明想找的商品");
    expect(result.current.task).toBeNull();
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("空白或超过1000字符的消息不发出请求", async () => {
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => {
      await result.current.send("   ");
      await result.current.send("字".repeat(1001));
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("可继续在澄清任务中发送数值答案和当前任务上下文", async () => {
    mocks.send.mockResolvedValueOnce({ success: true, data: { task: clarified } })
      .mockResolvedValueOnce({ success: true, data: { task: clarified, reply: "已收到条件" } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => { await result.current.send("大容量充电宝"); });
    await act(async () => { await result.current.send("20000mAh"); });
    expect(mocks.send.mock.calls[1][2]).toEqual(clarified);
    expect(result.current.messages.at(-1)?.text).toBe("已收到条件");
  });
});
