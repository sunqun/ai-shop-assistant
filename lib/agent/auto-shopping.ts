/**
 * AI 购物 ReAct 执行器。
 *
 * 负责让大模型通过 ReAct 循环调用工具，完成"搜索商品 → 选品 → 加入 AI 购物车 → 报价"的准备流程。
 * 实际下单由服务端任务屏障（shopping-task-service 的 commitOrder）控制，模型不能自行下单。
 *
 * 两种使用方式：
 *   1. 任务模式（传入 control）：只准备商品与报价，逐步写回任务快照，下单交由任务状态机。
 *   2. 独立模式（不传 control，confirmOrder 决定是否下单）：一次性完成准备与（可选）下单。
 */
import { randomUUID } from "node:crypto";
import { createLLMFromEnv } from "@/lib/llm";
import { runReAct } from "@/lib/llm/reAct";
import type { Message, Tool } from "@/lib/llm/type";
import { z } from "zod";
import { searchProductsForAgent } from "@/lib/agent/search-products-agent";
import { invokeAgentTool } from "@/lib/agent/tool-registry";
import type { CatalogProduct } from "@/lib/catalog";
import type { OrderToolOutput, QuoteToolOutput } from "@/lib/mcp/types";
import type { ShoppingTaskData } from "../shop-task/shopping-task-types";
import type { DialogueSnapshot } from "../intent/type";

// 任务模式下由调用方注入的控制钩子，用于取消检查、阶段推进与进度回写。
export type ShoppingPreparationControl = {
  shoppingTaskId?: string;
  signal: AbortSignal; // 用于超时/取消中断 ReAct 循环
  beforeTool: (phase?: "searching" | "selecting" | "reconciling" | "quoting") => Promise<void>; // 每个工具执行前的状态检查
  onProgress: (data: ShoppingTaskData) => Promise<void>; // 把工具产出写回任务数据
  cartIdempotencyKey: string; // 加购的幂等键，保证任务重试不重复加购
};

// ReAct 流程的最终结果。
type ShoppingFinal = {
  status:
    | "ready_for_confirmation"
    | "ordered"
    | "needs_login"
    | "needs_authorization"
    | "needs_clarification"
    | "failed";
  message: string;
  product?: CatalogProduct;
  quantity?: number;
  quote?: QuoteToolOutput;
  order?: unknown;
};

// 从商品列表中选择第一个有库存（stock > 0）的商品。
export function selectTopInStockProduct<T extends { stock: number }>(products: T[]): T | undefined {
  return products.find((product) => product.stock > 0);
}

export async function runShoppingReAct(input: {
  query: string;
  userid: string;
  dialogue?: DialogueSnapshot;
  sessionId?: string;
  confirmOrder: boolean;
  control?: ShoppingPreparationControl;
}): Promise<ShoppingFinal> {
  let candidates: CatalogProduct[] = [];
  let selected: CatalogProduct | undefined;
  let cartVersion: number | undefined;
  let quote: QuoteToolOutput | undefined;
  let order: OrderToolOutput | undefined;
  let cartResult: unknown;
  const control = input.control;
  // 先按用户原话检索；后续模型改写 query 不能丢掉容量、预算或排除条件。
  await control?.beforeTool("searching");
  // 搜索商品：返回预检索得到的有货候选，模型不得凭 query 自行虚构商品。
  const searchResult = await searchProductsForAgent(
    input.query,
    100,
    undefined,
    input.sessionId,
    input.dialogue?.routing
      ? {
          intent: input.dialogue.intent,
          routing: input.dialogue.routing,
        }
      : undefined
  );
  if (!searchResult.ok) throw new Error(searchResult.message);
  const requestedQuantity = searchResult.intent.quantity ?? 1;
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 99)
    return { status: "needs_clarification", message: "请确认明确的购买数量（1–99件）。" };
  // 从预检索结果中筛选出有货商品。
  candidates = searchResult.data.products.filter((product) => product.stock > 0);
  const candidate = selectTopInStockProduct(candidates);
  await control?.onProgress({
    product: candidate,
    quantity: requestedQuantity,
    dialogue: {
      intent: searchResult.intent,
      routing: searchResult.routing,
      unresolvedRequired: searchResult.data.clarificationContext?.unresolvedRequired ?? [],
      unresolvedPreferences: searchResult.data.clarificationContext?.unresolvedPreferences ?? [],
      pendingSlot: searchResult.data.clarificationContext?.pendingSlot,
    },
  });
  // 需要澄清且已有候选商品：返回澄清提示，交由上层进入 needs_clarification 终态。
  if (searchResult.data.clarification && candidate) {
    await control?.onProgress({ clarification: searchResult.data.clarification });
    return {
      status: "needs_clarification",
      message: searchResult.data.clarification,
      product: candidate,
      quantity: requestedQuantity,
    };
  }
  // 无有货候选商品则直接失败。
  if (!candidate)
    return { status: "failed", message: "没有找到符合当前明确条件的有货商品，请调整需求后重试。" };
  const llm = createLLMFromEnv();
  // This endpoint is a single HTTP response rather than a streamed UI session,
  // so expose retry progress in server logs while the shared client retries safely.
  llm.addEventListener("retry", (event) => {
    const { attempt, maxAttempts, lastError } = (
      event as CustomEvent<{ attempt: number; maxAttempts: number; lastError: unknown }>
    ).detail;
    const errorType =
      lastError && typeof lastError === "object" && "type" in lastError
        ? String(lastError.type)
        : "unknown";
    console.warn("shopping assistant model retry", { attempt, maxAttempts, errorType });
  });

  // 模型可调用的工具集合；description 与 inputSchema 面向模型，execute 为真实执行逻辑。
  const tools: Record<string, Tool> = {
    // 搜索商品：返回预检索得到的有货候选，模型不得凭 query 自行虚构商品。
    search_products: {
      description:
        "Read the real catalog results for the original user request. Original constraints are preserved even if query is rewritten.",
      retryOnExecutionError: true,
      inputSchema: z.object({ query: z.string().trim().min(1).max(1000) }).strict(),
      execute: async () => {
        await control?.beforeTool("searching");
        // 已准备好购物车后不允许再搜索，防止覆盖已有报价。
        if (control && cartVersion)
          throw new Error("The cart is already prepared; finish with the current quote");
        return {
          products: candidates,
          nextCursor: searchResult.data.nextCursor,
          intentSummary: searchResult.intent,
        };
      },
    },
    // 选品：选择候选中第一个有库存商品。
    select_recommended_product: {
      description:
        "Select the first in-stock product from the latest catalog search results, preserving the order returned by the catalog.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        await control?.beforeTool("selecting");
        if (control && cartVersion) return { product: selected };
        selected = selectTopInStockProduct(candidates);
        if (!selected) throw new Error("No in-stock product matched the request");
        await control?.onProgress({ product: selected });
        return { product: selected };
      },
    },
    // 件数来自已经核实的用户意图，不能由ReAct模型改写。
    add_selected_to_cart: {
      description: "Add the selected product using the server-verified requested quantity.",
      inputSchema: z.object({ quantity: z.number().int().min(1).max(99) }).strict(),
      execute: async () => {
        await control?.beforeTool("reconciling");
        if (control && cartVersion) return cartResult;
        if (!selected) throw new Error("Select a product before adding to cart");
        const result = await invokeAgentTool(
          "reconcile_cart",
          {
            items: [{ id: selected.id, quantity: requestedQuantity }],
            idempotencyKey: control?.cartIdempotencyKey ?? randomUUID(),
          },
          { userid: input.userid }
        );
        if (!result.ok) throw new Error(result.error.message);
        if (result.data.allocations?.some((item) => item.allocatedQuantity < item.quantity)) {
          const clarification = `所选商品无法提供请求的${requestedQuantity}件，请调整数量或选择其他商品后继续。`;
          await control?.onProgress({ clarification });
          throw new Error(clarification);
        }
        cartVersion = result.data.cartVersion;
        cartResult = result.data;
        return result.data;
      },
    },
    // 报价：基于购物车版本核验库存并计算金额。
    quote_cart: {
      description: "Revalidate stock and calculate the current total before ordering.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        await control?.beforeTool("quoting");
        if (control && quote) return quote;
        if (!cartVersion) throw new Error("Add a product to the cart before quoting");
        const result = await invokeAgentTool(
          "quote_cart",
          { cartVersion },
          { userid: input.userid, shoppingTaskId: control?.shoppingTaskId }
        );
        if (!result.ok) throw new Error(result.error.message);
        quote = result.data;
        await control?.onProgress({ quote });
        return result.data;
      },
    },
    // 下单：仅独立模式且用户确认时才真正下单；任务模式只返回"待确认"。
    submit_order: {
      description: "Submit the quoted AI order only when the user explicitly confirmed the order.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        await control?.beforeTool();
        // 任务模式只准备报价，下单必须经过服务端任务的原子状态屏障。
        if (control) return { status: "confirmation_required", quote };
        if (!input.confirmOrder) return { status: "confirmation_required", quote };
        if (!cartVersion || !quote || typeof quote !== "object" || !("quote" in quote))
          throw new Error("Quote the cart before ordering");
        const quoteId = String((quote as { quote: { quoteId: string } }).quote.quoteId);
        const result = await invokeAgentTool(
          "submit_order",
          { cartVersion, quoteId, idempotencyKey: randomUUID() },
          { userid: input.userid }
        );
        if (!result.ok) throw new Error(result.error.message);
        order = result.data;
        return result.data;
      },
    },
    // 收尾：把真实执行结果收敛为最终状态，避免模型伪造 order/quote。
    final_answer: {
      description: "Finish with a concise user-facing result after the workflow is complete.",
      inputSchema: z
        .object({
          status: z.enum([
            "ready_for_confirmation",
            "ordered",
            "needs_login",
            "needs_authorization",
            "failed",
          ]),
          message: z.string().trim().min(1).max(1000),
        })
        .strict(),
      execute: async (result: ShoppingFinal) => {
        await control?.beforeTool();
        return {
          ...result,
          // 最终状态以真实执行结果为准：有 order 才算 ordered，有 quote 才算待确认。
          status: order ? "ordered" : quote ? "ready_for_confirmation" : "failed",
          product: selected,
          quantity: requestedQuantity,
          quote,
          order,
        };
      },
    },
  };

  const messages: Message[] = [
    {
      role: "system",
      content: [
        "You are a shopping ReAct agent.",
        `Use tools to search the real catalog, select the first in-stock product in catalog order, add exactly ${requestedQuantity} units, quote the cart, and submit only if user confirmation is true.`,
        `User confirmation is ${input.confirmOrder ? "true" : "false"}.`,
        "Never invent product, price, stock, quote, or order data. End by calling final_answer.",
      ].join("\n"),
    },
    { role: "user", content: input.query },
  ];

  // LLM.client is the retry-aware facade, so every ReAct model step gets the
  // same transport retry handling as the one-shot intent parser.
  const result = await runReAct<ShoppingFinal>(llm.client, messages, tools, "final_answer", {
    maxSteps: 8,
    abortSignal: control?.signal,
  });
  return result.result;
}

// 独立确认下单入口：由外部（如旧确认接口）直接提交已报价的 AI 订单。
export async function confirmShoppingOrder(input: {
  userid: string;
  cartVersion: number;
  quoteId: string;
  idempotencyKey: string;
}) {
  const result = await invokeAgentTool(
    "submit_order",
    {
      cartVersion: input.cartVersion,
      quoteId: input.quoteId,
      idempotencyKey: input.idempotencyKey,
    },
    { userid: input.userid }
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
