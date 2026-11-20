import { randomUUID } from "node:crypto";
import { createLLMFromEnv } from "@/lib/llm";
import { runReAct } from "@/lib/llm/react";
import type { Message, Tool } from "@/lib/llm/type";
import { z } from "zod";
import { searchProductsForAgent } from "@/lib/agent/search-products-agent";
import { invokeAgentTool } from "@/lib/agent/tool-registry";
import type { CatalogProduct } from "@/lib/catalog";
import type { QuoteToolOutput } from "@/lib/mcp/types";

type ShoppingFinal = {
  status: "ready_for_confirmation" | "ordered" | "needs_login" | "needs_authorization" | "failed";
  message: string;
  product?: CatalogProduct;
  quote?: QuoteToolOutput;
  order?: unknown;
};

export function selectTopInStockProduct<T extends { stock: number }>(products: T[]): T | undefined {
  return products.find((product) => product.stock > 0);
}

export async function runShoppingReAct(input: {
  query: string;
  userid: string;
  sessionId?: string;
  confirmOrder: boolean;
}): Promise<ShoppingFinal> {
  let candidates: CatalogProduct[] = [];
  let selected: CatalogProduct | undefined;
  let cartVersion: number | undefined;
  let quote: QuoteToolOutput | undefined;
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

  const tools: Record<string, Tool> = {
    search_products: {
      description: "Search the real product catalog for the user's request.",
      retryOnExecutionError: true,
      inputSchema: z.object({ query: z.string().trim().min(1).max(1000) }).strict(),
      execute: async ({ query }: { query: string }) => {
        const result = await searchProductsForAgent(query, 100, undefined, input.sessionId);
        if (!result.ok) throw new Error(result.message);
        candidates = result.data.products.filter((product) => product.stock > 0);
        return {
          products: candidates,
          nextCursor: result.data.nextCursor,
          intentSummary: result.intent,
        };
      },
    },
    select_recommended_product: {
      description:
        "Select the first in-stock product from the latest catalog search results, preserving the order returned by the catalog.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        selected = selectTopInStockProduct(candidates);
        if (!selected) throw new Error("No in-stock product matched the request");
        return { product: selected };
      },
    },
    add_selected_to_cart: {
      description: "Add the selected product, quantity one, to the AI cart.",
      inputSchema: z.object({ quantity: z.number().int().min(1).max(10) }).strict(),
      execute: async ({ quantity }: { quantity: number }) => {
        if (!selected) throw new Error("Select a product before adding to cart");
        const result = await invokeAgentTool(
          "reconcile_cart",
          {
            items: [{ id: selected.id, quantity }],
            idempotencyKey: randomUUID(),
          },
          { userid: input.userid }
        );
        if (!result.ok) throw new Error(result.error.message);
        cartVersion = result.data.cartVersion;
        return result.data;
      },
    },
    quote_cart: {
      description: "Revalidate stock and calculate the current total before ordering.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        if (!cartVersion) throw new Error("Add a product to the cart before quoting");
        const result = await invokeAgentTool(
          "quote_cart",
          { cartVersion },
          { userid: input.userid }
        );
        if (!result.ok) throw new Error(result.error.message);
        quote = result.data;
        return result.data;
      },
    },
    submit_order: {
      description: "Submit the quoted AI order only when the user explicitly confirmed the order.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
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
        return result.data;
      },
    },
    final_answer: {
      description: "Finish with a concise user-facing result after the workflow is complete.",
      inputSchema: z.object({
        status: z.enum(["ready_for_confirmation", "ordered", "needs_login", "needs_authorization", "failed"]),
        message: z.string().trim().min(1).max(1000),
      }).strict(),
      execute: async (result: ShoppingFinal) => ({ ...result, product: selected, quote, order: result.order }),
    },
  };

  const messages: Message[] = [
    {
      role: "system",
      content: [
        "You are a shopping ReAct agent.",
        "Use tools to search the real catalog, select the first in-stock product in the order returned by the catalog, add quantity one, quote the cart, and submit only if user confirmation is true.",
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
  });
  return result.result;
}

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
