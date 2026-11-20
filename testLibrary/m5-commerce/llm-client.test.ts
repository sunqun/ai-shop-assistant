import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LLM, parseLLMConfig } from "@/lib/llm";
import type { Tool } from "@/lib/llm/type";

function responseForToolCall() {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "parse", arguments: JSON.stringify({ value: "ok" }) },
              },
            ],
          },
        },
      ],
      usage: {},
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

const parseTool: Tool = {
  inputSchema: z.object({ value: z.string() }),
  execute: async (args) => args,
};

describe("LLM client configuration and endpoint handling", () => {
  it("preserves optional config fields", () => {
    const customFetch = vi.fn();
    const parsed = parseLLMConfig({
      baseURL: "https://model.test/v1",
      model: "test-model",
      apiKey: "key",
      maxRetries: 1,
      disableNamedToolChoice: true,
      customFetch,
    });

    expect(parsed.disableNamedToolChoice).toBe(true);
    expect(parsed.customFetch).toBe(customFetch);
  });

  it("keeps named tool choice for DeepSeek and avoids duplicate endpoint suffixes", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.tool_choice).toEqual({
        type: "function",
        function: { name: "parse" },
      });
      expect(body.thinking).toEqual({ type: "disabled" });
      return responseForToolCall();
    });
    const llm = new LLM({
      baseURL: "https://model.test/v1/chat/completions/",
      model: "deepseek-chat",
      apiKey: "key",
      maxRetries: 0,
      customFetch: fetchMock,
    });

    await llm.invoke(
      [{ role: "user", content: "test" }],
      { parse: parseTool },
      new AbortController().signal,
      { toolChoiceName: "parse", temperature: 0 }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://model.test/v1/chat/completions",
      expect.any(Object)
    );
  });

  it("applies retry policy and emits retry events when ReAct uses llm.client", async () => {
    const fetchMock = vi
      .fn< typeof fetch >()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(responseForToolCall());
    const llm = new LLM({
      baseURL: "https://model.test/v1",
      model: "test-model",
      apiKey: "key",
      maxRetries: 1,
      customFetch: fetchMock,
    });
    const retryListener = vi.fn();
    llm.addEventListener("retry", retryListener);

    await llm.client.invoke(
      [{ role: "user", content: "test" }],
      { parse: parseTool },
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retryListener).toHaveBeenCalledTimes(1);
    expect(retryListener.mock.calls[0]?.[0]).toMatchObject({
      type: "retry",
      detail: { attempt: 1, maxAttempts: 1 },
    });
  });

  it("does not retry tool execution failures that may follow a business side effect", async () => {
    const fetchMock = vi.fn(async () => responseForToolCall());
    const execute = vi.fn(async () => {
      throw new Error("business action failed");
    });
    const llm = new LLM({
      baseURL: "https://model.test/v1",
      model: "test-model",
      apiKey: "key",
      maxRetries: 2,
      customFetch: fetchMock,
    });

    await expect(
      llm.client.invoke(
        [{ role: "user", content: "test" }],
        { parse: { ...parseTool, execute } },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ type: "tool_execution_error", retryable: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("can retry execution failures for an explicitly repeat-safe tool", async () => {
    const fetchMock = vi.fn(async () => responseForToolCall());
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValueOnce({ value: "ok" });
    const llm = new LLM({
      baseURL: "https://model.test/v1",
      model: "test-model",
      apiKey: "key",
      maxRetries: 1,
      customFetch: fetchMock,
    });

    await llm.client.invoke(
      [{ role: "user", content: "test" }],
      { parse: { ...parseTool, retryOnExecutionError: true, execute } },
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
