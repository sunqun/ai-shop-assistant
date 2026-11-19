import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runReAct, ReActLimitError } from "@/llm/react";
import type { InvokeResult, LLMClient, Tool } from "@/llm/type";

function tool(name: string, execute = vi.fn(async () => ({ ok: true }))): Tool {
  return { inputSchema: z.object({}), execute };
}

function clientFor(names: string[]): LLMClient {
  let index = 0;
  return {
    invoke: vi.fn(async () => {
      const name = names[index++]!;
      return {
        toolCall: { name, args: {} },
        toolResult: name === "finish" ? { status: "done" } : { ok: true },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
        assistantMessage: { role: "assistant" as const, content: null, tool_calls: [{ id: `call-${index}`, type: "function" as const, function: { name, arguments: "{}" } }] },
      } satisfies InvokeResult;
    }),
  };
}

describe("runReAct", () => {
  it("returns when the registered final tool is called and emits ordered events", async () => {
    const onEvent = vi.fn();
    const result = await runReAct<{ status: string }>(clientFor(["lookup", "finish"]), [], {
      lookup: tool("lookup"), finish: tool("finish"),
    }, "finish", { onEvent });

    expect(result.result).toEqual({ status: "done" });
    expect(result.steps).toBe(2);
    expect(result.messages.filter((message) => message.role === "tool")).toHaveLength(1);
    expect(result.events.map((event) => event.type)).toEqual([
      "step_started", "tool_call", "tool_result", "step_started", "tool_call", "final",
    ]);
    expect(onEvent).toHaveBeenCalledTimes(6);
  });

  it("throws a diagnostic limit error and emits an error event", async () => {
    const onEvent = vi.fn();
    await expect(runReAct(clientFor(["lookup"]), [], {
      lookup: tool("lookup"), finish: tool("finish"),
    }, "finish", { maxSteps: 1, onEvent })).rejects.toBeInstanceOf(ReActLimitError);
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("honors cancellation before invoking the model", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = clientFor(["finish"]);
    await expect(runReAct(client, [], { finish: tool("finish") }, "finish", {
      abortSignal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("requires the final tool to be registered", async () => {
    await expect(runReAct(clientFor([]), [], { lookup: tool("lookup") }, "finish"))
      .rejects.toThrow('Final tool "finish" is not registered');
  });
});
