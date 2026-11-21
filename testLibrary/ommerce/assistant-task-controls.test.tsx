import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantComposer } from "@/app/assistant/assistant-composer";
import type { AssistantController } from "@/app/assistant/use-assistant";
import type { ShoppingTask } from "@/lib/shop-task/shopping-task-types";
import { AssistantMessages } from "@/app/assistant/assistant-messages";
import { product } from "../intent/fixtures";

afterEach(cleanup);
function controller(phase: ShoppingTask["phase"]): AssistantController {
  return {
    query: "",
    setQuery: vi.fn(),
    busy: true,
    canSend: true,
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
      product,
      quantity: 1,
      differences: [
        {
          requirement: "续航至少10小时",
          actual: "续航6小时",
          status: "not_met",
        },
      ],
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
      taskId: "fixture",
      phase,
      canCancel: ["searching", "ready_to_order", "awaiting_confirmation"].includes(phase),
      canConfirm: phase === "awaiting_confirmation",
      canRecover: phase === "reconciling_result",
      commitAfter: new Date(Date.now() + 3000).toISOString(),
      terminal: ["ordered", "failed", "needs_clarification"].includes(phase),
    },
  } as unknown as AssistantController;
}

describe("assistant task controls", () => {
  it("allows messages and cancellation while search is busy", () => {
    const props = controller("searching");
    render(<AssistantComposer controller={props} />);
    expect(screen.getByRole("textbox")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "取消并生成短链" }));
    expect(props.cancelToPaymentLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "确认下单" })).not.toBeInTheDocument();
  });
  it("shows differences and the complete quote in chat with confirmation above the normal input", () => {
    const props = controller("awaiting_confirmation");
    const task = props.task!;
    render(
      <>
        <AssistantMessages
          messages={[
            {
              role: "assistant",
              taskId: task.taskId,
              text: "请核对当前商品",
              result: {
                status: "ready_for_confirmation",
                product: task.product,
                quantity: task.quantity,
                differences: task.differences,
                quote: task.quote,
              },
            },
          ]}
          busy={false}
          error=""
          copyShortLink={vi.fn()}
          send={props.send}
          canSend
          task={task}
        />
        <AssistantComposer controller={props} />
      </>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/续航至少10小时/)).toBeInTheDocument();
    expect(screen.getByText(/实际：续航6小时/)).toBeInTheDocument();
    expect(screen.getByText("支付总额")).toBeInTheDocument();
    const bar = screen.getByText(/请核对上方商品差异和报价/).closest(".agent-test__confirm")!;
    const confirm = screen.getByRole("button", { name: "确认下单" });
    expect(bar.contains(confirm)).toBe(true);
    expect(
      bar.compareDocumentPosition(screen.getByRole("textbox")) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(confirm);
    expect(props.confirmOrder).toHaveBeenCalledExactlyOnceWith({
      quoteId: "shown-quote",
      cartVersion: 2,
    });
  });
  it("offers cancellation and countdown before automatic submission", () => {
    render(<AssistantComposer controller={controller("ready_to_order")} />);
    expect(screen.getByRole("button", { name: "取消并生成短链" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "确认下单" })).not.toBeInTheDocument();
    expect(screen.getByText(/秒后自动创建订单/)).toBeInTheDocument();
  });
  it("cancels a pending difference decision from the inline row", () => {
    const props = controller("awaiting_confirmation");
    render(<AssistantComposer controller={props} />);
    fireEvent.click(screen.getByRole("button", { name: "取消并生成短链" }));
    expect(props.cancelToPaymentLink).toHaveBeenCalledTimes(1);
    expect(props.confirmOrder).not.toHaveBeenCalled();
  });
  it.each(["searching", "ready_to_order", "ordered"] as const)(
    "does not show confirmation for %s",
    (phase) => {
      render(<AssistantComposer controller={controller(phase)} />);
      expect(screen.queryByRole("button", { name: "确认下单" })).not.toBeInTheDocument();
    }
  );
  it("disables transaction actions while disconnected", () => {
    const props = controller("awaiting_confirmation");
    props.connectionLost = true;
    render(<AssistantComposer controller={props} />);
    expect(screen.getByRole("button", { name: "确认下单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消并生成短链" })).toBeDisabled();
  });
  it("allows help-order from the normal conversation input while awaiting acceptance", () => {
    const props = controller("awaiting_confirmation");
    props.query = "帮我下单";
    render(<AssistantComposer controller={props} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", code: "Enter" });
    expect(props.send).toHaveBeenCalledExactlyOnceWith("帮我下单");
  });
  it("provides explicit progress refresh for a restored in-progress task", () => {
    const props = controller("searching");
    props.paused = true;
    render(<AssistantComposer controller={props} />);
    fireEvent.click(screen.getByRole("button", { name: "刷新进度" }));
    expect(props.refreshTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "继续执行" })).not.toBeInTheDocument();
  });
  it("hides cancellation as soon as creation starts", () => {
    render(<AssistantComposer controller={controller("committing")} />);
    expect(screen.queryByRole("button", { name: "取消并生成短链" })).not.toBeInTheDocument();
    expect(screen.getByText(/正在创建订单/)).toBeInTheDocument();
  });
  it("offers original-task recovery when the order outcome is unknown", () => {
    render(<AssistantComposer controller={controller("reconciling_result")} />);
    expect(screen.getByRole("button", { name: "核对订单结果" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "取消并生成短链" })).not.toBeInTheDocument();
  });
});
