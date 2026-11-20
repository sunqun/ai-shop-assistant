import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantComposer } from "@/app/assistant/assistant-composer";
import type { AssistantController } from "@/app/assistant/use-assistant";
import type { ShoppingTask } from "@/lib/agent/shopping-task-types";

afterEach(cleanup);
function controller(phase: ShoppingTask["phase"]): AssistantController {
  return {
    query: "",
    setQuery: vi.fn(),
    busy: true,
    inputRef: { current: null },
    send: vi.fn(),
    submit: vi.fn(),
    paused: false,
    submitting: false,
    canceling: false,
    connectionLost: false,
    confirmOrder: vi.fn(),
    cancelToPaymentLink: vi.fn(),
    resume: vi.fn(),
    refreshTask: vi.fn(),
    retryPaymentLink: vi.fn(),
    recoverOrder: vi.fn(),
    task: {
      taskId: "fixture",
      phase,
      canCancel: ["searching", "ready_to_order", "awaiting_confirmation"].includes(phase),
      canConfirm: phase === "awaiting_confirmation",
      canRecover: phase === "reconciling_result",
      commitAfter: new Date(Date.now() + 3000).toISOString(),
      terminal: false,
    },
  } as unknown as AssistantController;
}

describe("assistant task controls", () => {
  it("allows canceling a busy search while leaving the message composer disabled", () => {
    const props = controller("searching");
    render(<AssistantComposer controller={props} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    const cancel = screen.getByRole("button", { name: "取消并生成短链" });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(props.cancelToPaymentLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "确认下单" })).not.toBeInTheDocument();
  });

  it("offers explicit confirmation only in manual waiting state", () => {
    render(<AssistantComposer controller={controller("awaiting_confirmation")} />);
    expect(screen.getByRole("button", { name: "确认下单" })).toBeEnabled();
  });

  it("offers cancellation and a countdown but no confirm button in automatic mode", () => {
    render(<AssistantComposer controller={controller("ready_to_order")} />);
    expect(screen.getByRole("button", { name: "取消并生成短链" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "确认下单" })).not.toBeInTheDocument();
    expect(screen.getByText(/秒后自动创建订单/)).toBeInTheDocument();
  });

  it("hides cancellation as soon as creation starts", () => {
    render(<AssistantComposer controller={controller("committing")} />);
    expect(screen.queryByRole("button", { name: "取消并生成短链" })).not.toBeInTheDocument();
    expect(screen.getByText(/正在创建订单/)).toBeInTheDocument();
  });

  it("offers recovery rather than canceling when the order outcome is unknown", () => {
    render(<AssistantComposer controller={controller("reconciling_result")} />);
    expect(screen.getByRole("button", { name: "核对订单结果" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "取消并生成短链" })).not.toBeInTheDocument();
  });
});
