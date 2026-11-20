import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "@/lib/llm/type";
import { runShoppingReAct, type ShoppingPreparationControl } from "@/lib/agent/auto-shopping";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  invokeTool: vi.fn(),
  steps: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));
vi.mock("@/lib/agent/search-products-agent", () => ({ searchProductsForAgent: mocks.search }));
vi.mock("@/lib/agent/tool-registry", () => ({ invokeAgentTool: mocks.invokeTool }));
vi.mock("@/lib/llm", () => ({
  createLLMFromEnv: () => ({
    addEventListener: vi.fn(),
    client: {
      invoke: async (_messages: unknown, tools: Record<string, Tool>) => {
        const step = mocks.steps.shift();
        if (!step) throw new Error("Missing fixture model step");
        const tool = tools[step.name]!;
        const args = tool.inputSchema.parse(step.args);
        return {
          toolCall: { name: step.name, args },
          toolResult: await tool.execute(args),
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0,
          },
        };
      },
    },
  }),
}));

const product = { id: "rank-first", stock: 3 };
const quote = { quote: { quoteId: "quote-fixture", cartVersion: 2 } };
const order = { orderGroupId: "actual-order", orders: [{ orderId: "actual-child" }] };
const input = { query: "coffee", userid: "fixture-user", confirmOrder: false };
function control(): ShoppingPreparationControl {
  return {
    signal: new AbortController().signal,
    beforeTool: vi.fn(async () => {}),
    onProgress: vi.fn(async () => {}),
    cartIdempotencyKey: "stable-task-cart-key",
  };
}
const final = { name: "final_answer", args: { status: "ordered", message: "fixture" } };

describe("shopping ReAct controlled preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.steps = [
      { name: "search_products", args: { query: "coffee" } },
      { name: "select_recommended_product", args: {} },
      { name: "add_selected_to_cart", args: { quantity: 7 } },
      { name: "quote_cart", args: {} },
      { name: "submit_order", args: {} },
      final,
    ];
    mocks.search.mockResolvedValue({ ok: true, data: { products: [product] }, intent: {} });
    mocks.invokeTool.mockImplementation(async (name: string) => ({
      ok: true,
      data: name === "reconcile_cart" ? { cartVersion: 2 } : name === "quote_cart" ? quote : order,
    }));
  });

  it("prepares a real quote, enforces quantity one, and never submits from task-controlled ReAct", async () => {
    const hooks = control();
    const result = await runShoppingReAct({ ...input, confirmOrder: true, control: hooks });
    expect(result).toMatchObject({ status: "ready_for_confirmation", product, quote });
    expect(result.order).toBeUndefined();
    expect(mocks.invokeTool).toHaveBeenCalledWith(
      "reconcile_cart",
      { items: [{ id: product.id, quantity: 1 }], idempotencyKey: hooks.cartIdempotencyKey },
      { userid: input.userid }
    );
    expect(mocks.invokeTool.mock.calls.some(([name]) => name === "submit_order")).toBe(false);
    expect(hooks.onProgress).toHaveBeenCalledWith({ quote });
  });

  it("does not execute another tool after cancellation is accepted during search", async () => {
    const hooks = control();
    vi.mocked(hooks.beforeTool).mockImplementation(async (phase) => {
      if (phase === "selecting") {
        const error = new Error("canceled");
        error.name = "AbortError";
        throw error;
      }
    });
    await expect(runShoppingReAct({ ...input, control: hooks })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(hooks.onProgress).toHaveBeenCalledWith({ product });
    expect(mocks.invokeTool).not.toHaveBeenCalled();
  });

  it("returns actual legacy order data instead of a model-supplied order status alone", async () => {
    expect(await runShoppingReAct({ ...input, confirmOrder: true })).toMatchObject({
      status: "ordered",
      order,
    });
  });

  it("rejects model claims of completion without tool evidence", async () => {
    mocks.steps = [final];
    expect(await runShoppingReAct({ ...input, control: control() })).toMatchObject({
      status: "failed",
    });
    expect(mocks.invokeTool).not.toHaveBeenCalled();
  });

  it("does not repeat cart mutations when the model calls add twice", async () => {
    mocks.steps.splice(3, 0, { name: "add_selected_to_cart", args: { quantity: 2 } });
    await runShoppingReAct({ ...input, control: control() });
    expect(mocks.invokeTool.mock.calls.filter(([name]) => name === "reconcile_cart")).toHaveLength(
      1
    );
  });
});
