import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistant } from "@/app/assistant/use-assistant";
import type { ShoppingTask } from "@/lib/agent/shopping-task-types";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  active: vi.fn(),
  action: vi.fn(),
}));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({ user: { userid: "hook-test" }, loading: false }),
}));
vi.mock("@/app/assistant/api", () => ({
  createShoppingTaskRequest: mocks.create,
  getShoppingTaskRequest: mocks.get,
  getActiveShoppingTaskRequest: mocks.active,
  shoppingTaskActionRequest: mocks.action,
}));

function task(phase: ShoppingTask["phase"] = "ready_to_order"): ShoppingTask {
  return {
    taskId: "fixture-task",
    query: "coffee",
    mode: "auto",
    phase,
    revision: 1,
    commitAfter: new Date(Date.now() + 3000).toISOString(),
    canCancel: true,
    canConfirm: false,
    canAdvance: true,
    canRecover: false,
    terminal: false,
    ...(phase === "awaiting_confirmation"
      ? { mode: "manual", canConfirm: true, canAdvance: false }
      : {}),
    ...(phase === "searching" ? { canAdvance: false } : {}),
  };
}
const success = (value: ShoppingTask) => ({ success: true, data: { task: value } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.active.mockResolvedValue({ success: true, data: { task: null } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("assistant task hook", () => {
  it("automatically advances after the deadline without a confirmation click", async () => {
    const ready = task();
    mocks.create.mockResolvedValue(success(ready));
    mocks.get.mockImplementation(async () => success({ ...ready }));
    mocks.action.mockResolvedValue(
      success({
        ...ready,
        phase: "ordered",
        revision: 2,
        terminal: true,
        canAdvance: false,
        canCancel: false,
      })
    );
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    act(() => result.current.setMode("auto"));
    await act(async () => {
      await result.current.send("coffee");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2900);
    });
    expect(mocks.action).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mocks.action).toHaveBeenCalledWith("fixture-task", "advance", undefined);
    expect(result.current.task?.phase).toBe("ordered");
    expect(result.current.busy).toBe(false);
  });

  it("never automatically advances a manual quote", async () => {
    const waiting = task("awaiting_confirmation");
    mocks.create.mockResolvedValue(success(waiting));
    mocks.get.mockResolvedValue(success(waiting));
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => {
      await result.current.send("coffee");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mocks.action).not.toHaveBeenCalled();
    expect(result.current.task?.canConfirm).toBe(true);
  });

  it("can cancel while the search is busy and displays the returned link", async () => {
    const searching = task("searching");
    mocks.create.mockResolvedValue(success(searching));
    mocks.action.mockResolvedValue(
      success({
        ...searching,
        revision: 2,
        phase: "canceled",
        terminal: true,
        canAdvance: false,
        canCancel: false,
        link: { urlToken: "fixture-link" },
      })
    );
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    await act(async () => {
      await result.current.send("coffee");
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      await result.current.cancelToPaymentLink();
    });
    expect(mocks.action).toHaveBeenCalledWith("fixture-task", "cancel", undefined);
    expect(result.current.busy).toBe(false);
    expect(result.current.messages.at(-1)?.shortLink).toContain("/handoff?token=fixture-link");
  });

  it("restores an automatic task paused until the user resumes", async () => {
    const ready = task();
    mocks.active.mockResolvedValue(success(ready));
    mocks.get.mockResolvedValue(success(ready));
    mocks.action.mockResolvedValue(
      success({
        ...ready,
        revision: 2,
        phase: "ordered",
        terminal: true,
        canAdvance: false,
        canCancel: false,
      })
    );
    const { result } = renderHook(useAssistant);
    await act(async () => {});
    expect(result.current.paused).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.action).not.toHaveBeenCalled();
    act(() => result.current.resume());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mocks.action).toHaveBeenCalledTimes(1);
  });
});
