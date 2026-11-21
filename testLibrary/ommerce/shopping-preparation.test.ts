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
const input = { query: "coffee", userid: "fixture-user" };
function control(): ShoppingPreparationControl {
  return {
    shoppingTaskId: "fixture-task",
    signal: new AbortController().signal,
    beforeTool: vi.fn(async () => {}),
    onProgress: vi.fn(async () => {}),
    cartIdempotencyKey: "stable-task-cart-key",
  };
}
const final = { name: "final_answer", args: { status: "ready_for_confirmation", message: "fixture" } };

describe("shopping ReAct controlled preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.steps = [
      { name: "search_products", args: { query: "coffee" } },
      { name: "select_recommended_product", args: {} },
      { name: "add_selected_to_cart", args: { quantity: 7 } },
      { name: "quote_cart", args: {} },
      final,
    ];
    mocks.search.mockResolvedValue({ ok: true, data: { products: [product] }, intent: {} });
    mocks.invokeTool.mockImplementation(async (name: string) => ({
      ok: true,
      data: name === "reconcile_cart" ? { cartVersion: 2 } : quote,
    }));
  });

  it("defaults to one verified unit and never submits from task-controlled ReAct", async () => {
    const hooks = control();
    const result = await runShoppingReAct({ ...input, control: hooks });
    expect(result).toMatchObject({ status: "ready_for_confirmation", product, quote });
    expect(mocks.invokeTool).toHaveBeenCalledWith(
      "reconcile_cart",
      { items: [{ id: product.id, quantity: 1 }], idempotencyKey: hooks.cartIdempotencyKey },
      { userid: input.userid }
    );
    expect(mocks.invokeTool.mock.calls.some(([name]) => name === "submit_order")).toBe(false);
    expect(hooks.onProgress).toHaveBeenCalledWith({ quote });
  });
  it("报价任务上下文由服务端传递，不由模型声明自动优惠资格", async () => {
    const hooks = { ...control(), shoppingTaskId: "server-task" };
    await runShoppingReAct({ ...input, control: hooks });
    expect(mocks.invokeTool).toHaveBeenCalledWith("quote_cart", { cartVersion: 2 }, { userid: input.userid, shoppingTaskId: "server-task" });
  });
  it("BUG-I04: uses the verified quantity rather than a model rewritten quantity", async () => {
    mocks.search.mockResolvedValue({ ok: true, data: { products: [product] }, intent: { quantity: 3 } });
    const hooks = control();
    const result = await runShoppingReAct({ ...input, query: "买3个", control: hooks });
    expect(result.quantity).toBe(3);
    expect(mocks.invokeTool).toHaveBeenCalledWith("reconcile_cart", {
      items: [{ id: product.id, quantity: 3 }], idempotencyKey: hooks.cartIdempotencyKey,
    }, { userid: input.userid });
    expect(hooks.onProgress).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }));
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
    expect(hooks.onProgress).toHaveBeenCalledWith(expect.objectContaining({ product }));
    expect(mocks.invokeTool).not.toHaveBeenCalled();
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


  it("searches the original request instead of a model rewrite that drops constraints", async () => {
    mocks.steps[0].args = { query: "充电宝" };
    const original = "至少20000mAh、700元以内的充电宝，不要翻新";
    await runShoppingReAct({ ...input, query: original, control: control() });
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith(original, 100, undefined, undefined, undefined, true);
  });
  it("disclosed preference differences prepare a one-unit quote without model submission", async () => {
    mocks.search.mockResolvedValue({
      ok: true,
      intent: { preferences: ["价格合适"] },
      data: {
        products: [product], differences: [{ requirement: "价格合适", actual: "请核对商品单价", status: "unverified" }],
        clarificationContext: { unresolvedRequired: [], unresolvedPreferences: ["价格合适"] },
      },
    });
    const hooks = control();
    expect(await runShoppingReAct({ ...input, control: hooks })).toMatchObject({
      status: "ready_for_confirmation", product, quantity: 1, quote,
    });
    expect(hooks.onProgress).toHaveBeenCalledWith(expect.objectContaining({
      differences: [{ requirement: "价格合适", actual: "请核对商品单价", status: "unverified" }], quantity: 1, dialogue: expect.objectContaining({ unresolvedPreferences: ["价格合适"] }),
    }));
    expect(mocks.invokeTool.mock.calls.some(([name]) => name === "submit_order")).toBe(false);
  });
});
