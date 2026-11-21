import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingTask } from "@/lib/shop-task/shopping-task-types";
import { useAssistant } from "@/app/assistant/use-assistant";
import { product } from "../intent/fixtures";

const mocks = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn(), active: vi.fn(), action: vi.fn() }));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({ user: { userid: "fixture-refresh" }, loading: false }),
}));
vi.mock("@/app/assistant/api", () => ({
  sendAssistantMessageRequest: mocks.send,
  getShoppingTaskRequest: mocks.get,
  getActiveShoppingTaskRequest: mocks.active,
  shoppingTaskActionRequest: mocks.action,
}));

const waiting: ShoppingTask = {
  taskId: "refresh-task",
  query: "找蓝牙耳机",
  phase: "awaiting_confirmation",
  revision: 2,
  commitAfter: null,
  canCancel: true,
  canConfirm: true,
  canAdvance: false,
  canRecover: false,
  terminal: false,
  product,
  quantity: 1,
  differences: [{ requirement: "续航10小时", actual: "续航6小时", status: "not_met" }],
  quote: {
    quote: {
      quoteId: "shown-quote",
      cartId: "cart",
      cartVersion: 2,
      currency: "TWD",
      subtotalMinor: 50000,
      discountMinor: 2500,
      shippingMinor: 0,
      totalDueMinor: 47500,
      promotion: "C",
      label: "fixture",
      ruleVersion: "fixture",
      expiresAt: "2099-01-01T00:00:00Z",
    },
    appliedRules: [],
  },
};
const completed: ShoppingTask = {
  ...waiting,
  revision: 3,
  phase: "ordered",
  terminal: true,
  canConfirm: false,
  canCancel: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  sessionStorage.clear();
  mocks.active.mockResolvedValue({ success: true, data: { task: null } });
  mocks.send.mockResolvedValue({ success: true, data: { task: waiting, resumeTask: true } });
  mocks.get.mockResolvedValue({ success: true, data: { task: waiting } });
  mocks.action.mockResolvedValue({ success: true, data: { task: completed } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("assistant task updates without periodic queries", () => {
  it.each(["button", "message"])("shows an expired quote from %s and restores the failed task once", async (entry) => {
    const expired: ShoppingTask = {
      ...completed, phase: "failed", errorCode: "QUOTE_EXPIRED",
      error: "报价已失效，请获取并核对新报价后继续。",
    };
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => { await result.current.send("找蓝牙耳机"); });
    mocks.get.mockResolvedValue({ success: true, data: { task: expired } });
    const failure = { success: false, errorMsg: expired.error };
    mocks.action.mockResolvedValue(failure);
    mocks.send.mockResolvedValue(failure);
    await act(async () => {
      if (entry === "button") await result.current.confirmOrder({ quoteId: "shown-quote", cartVersion: 2 });
      else await result.current.send("帮我下单");
    });
    expect(result.current.error).toBe(expired.error);
    expect(result.current.task?.phase).toBe("failed");
    expect(result.current.messages.find((item) => item.taskId === waiting.taskId)?.result?.status).toBe("failed");
    expect(result.current.canSend).toBe(true);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(waiting.taskId);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("pauses a failed advance after one recovery query instead of automatically retrying", async () => {
    const queued: ShoppingTask = {
      ...waiting,
      phase: "queued",
      revision: 0,
      canConfirm: false,
      canAdvance: true,
      quote: undefined,
    };
    mocks.send.mockResolvedValue({ success: true, data: { task: queued, resumeTask: true } });
    mocks.action.mockResolvedValueOnce({ success: false, errorMsg: "推进暂时不可用" });
    mocks.get.mockResolvedValueOnce({ success: true, data: { task: queued } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => {
      await result.current.send("找蓝牙耳机");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(result.current.paused).toBe(true);
    expect(result.current.error).toBe("推进暂时不可用");
    mocks.action.mockResolvedValueOnce({ success: true, data: { task: waiting } });
    await act(async () => {
      result.current.resume();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.action).toHaveBeenCalledTimes(2);
    expect(result.current.task?.phase).toBe("awaiting_confirmation");
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("waits for inline acceptance without polling and uses the confirm response directly", async () => {
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => {
      await result.current.send("找蓝牙耳机");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.task?.phase).toBe("awaiting_confirmation");
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.confirmOrder({ quoteId: "shown-quote", cartVersion: 2 });
    });
    expect(mocks.action).toHaveBeenCalledExactlyOnceWith("refresh-task", "confirm", {
      quoteId: "shown-quote",
      cartVersion: 2,
    });
    expect(result.current.task?.phase).toBe("ordered");
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("does not query repeatedly while its own long-running advance request is pending", async () => {
    const queued: ShoppingTask = {
      ...waiting,
      phase: "queued",
      revision: 0,
      canConfirm: false,
      canAdvance: true,
      quote: undefined,
    };
    mocks.send.mockResolvedValue({ success: true, data: { task: queued, resumeTask: true } });
    let finish!: (value: { success: true; data: { task: ShoppingTask } }) => void;
    mocks.action.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => {
      await result.current.send("找蓝牙耳机");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.action).toHaveBeenCalledExactlyOnceWith("refresh-task", "advance", undefined);
    expect(mocks.get).not.toHaveBeenCalled();
    await act(async () => {
      finish({ success: true, data: { task: waiting } });
    });
    expect(result.current.task?.phase).toBe("awaiting_confirmation");
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("restores the current task without starting a recurring query", async () => {
    mocks.active.mockResolvedValue({ success: true, data: { task: waiting } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.active).toHaveBeenCalledTimes(1);
    expect(result.current.task?.phase).toBe("awaiting_confirmation");
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("refreshes a restored in-progress task only when explicitly requested", async () => {
    const searching: ShoppingTask = {
      ...waiting,
      phase: "searching",
      revision: 1,
      quote: undefined,
      canConfirm: false,
    };
    mocks.active.mockResolvedValue({ success: true, data: { task: searching } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.get).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.refreshTask();
    });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("refresh-task");
    expect(result.current.task?.phase).toBe("awaiting_confirmation");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("still automatically advances an exact match after the server deadline without GET polling", async () => {
    const ready: ShoppingTask = {
      ...waiting,
      phase: "ready_to_order",
      canConfirm: false,
      canAdvance: true,
      differences: [],
      commitAfter: new Date(Date.now() + 3000).toISOString(),
    };
    mocks.send.mockResolvedValue({ success: true, data: { task: ready, resumeTask: true } });
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => {
      await result.current.send("找蓝牙耳机");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(mocks.action).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.action).toHaveBeenCalledExactlyOnceWith("refresh-task", "advance", undefined);
    expect(result.current.task?.phase).toBe("ordered");
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
