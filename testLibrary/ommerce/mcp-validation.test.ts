import { describe, expect, it } from "vitest";
import { callCommerceTool } from "@/lib/mcp/commerce-server";

describe("commerce MCP validation", () => {
  it("rejects malformed reconcile arguments before service access", async () => {
    const result = await callCommerceTool({
      name: "commerce.reconcile_cart",
      arguments: { items: [{ id: "bad id", quantity: 1 }], idempotencyKey: "k" },
    }, { userid: "550e8400-e29b-41d4-a716-446655440000" });
    expect(result).toEqual({ ok: false, error: { code: "MCP_INVALID_ARGUMENTS", message: "AI 购物车参数无效。" } });
  });

  it("rejects malformed order context and payload", async () => {
    const result = await callCommerceTool(
      {
        name: "commerce.submit_order",
        arguments: { cartVersion: 1, quoteId: "not-a-uuid", idempotencyKey: "k" },
      },
      { userid: "not-a-uuid" },
    );
    expect(result).toEqual({ ok: false, error: { code: "UNAUTHENTICATED", message: "请先登录后再提交订单。" } });
  });

  it("rejects malformed order payload after context validation", async () => {
    const result = await callCommerceTool(
      {
        name: "commerce.submit_order",
        arguments: { cartVersion: 1, quoteId: "not-a-uuid", idempotencyKey: "k" },
      },
      { userid: "550e8400-e29b-41d4-a716-446655440000" },
    );
    expect(result).toEqual({ ok: false, error: { code: "MCP_INVALID_ARGUMENTS", message: "AI 下单参数无效。" } });
  });

  it("rejects unknown runtime tool names", async () => {
    const result = await callCommerceTool({ name: "commerce.unknown" as never, arguments: {} as never });
    expect(result).toEqual({ ok: false, error: { code: "MCP_TOOL_NOT_FOUND", message: "交易工具不存在。" } });
  });
});
