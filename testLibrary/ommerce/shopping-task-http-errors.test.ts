// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingTask } from "@/lib/shop-task/shopping-task-types";

const mocks = vi.hoisted(() => ({ session: vi.fn(), action: vi.fn(), message: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/auth/auth-server", () => ({ readSession: mocks.session }));
vi.mock("@/lib/shop-task/shopping-task-service", () => ({
  actOnShoppingTask: mocks.action, createShoppingTask: mocks.create,
}));
vi.mock("@/lib/agent/dialogue-agent", () => ({ handleAssistantMessage: mocks.message }));

import { POST as actionPost } from "@/app/api/v1/assistant/tasks/[taskId]/[action]/route";
import { POST as messagePost } from "@/app/api/v1/assistant/messages/route";
import { POST as createPost } from "@/app/api/v1/assistant/tasks/route";
import { readApiResponse, ApiRequestError } from "@/lib/auth/auth-retry";

const taskId = "ab478930-b0b7-4817-9cfc-103cb62db75c";
const quoteId = "dc95dfd5-36b9-4bdf-ac0a-ca2817ef9c34";
const message = "报价已失效，价格或优惠可能已变化，请获取并核对新报价后继续。";
const failed: ShoppingTask = {
  taskId, query: "找蓝牙耳机", phase: "failed", revision: 13, commitAfter: null,
  canCancel: false, canConfirm: false, canAdvance: false, canRecover: false, terminal: true,
  errorCode: "QUOTE_EXPIRED", error: message,
};
const request = (body: unknown) => new Request("http://localhost/api/v1/assistant/messages", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const context = (action: string) => ({ params: Promise.resolve({ taskId, action }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userid: "http-error-user" });
  mocks.action.mockResolvedValue(failed);
  mocks.message.mockResolvedValue({ task: failed, reply: "购物流程未完成。" });
  mocks.create.mockResolvedValue({ ...failed, phase: "queued", error: undefined, errorCode: undefined });
});

describe("shopping task HTTP failures", () => {
  it.each(["confirm", "advance", "recover"])("returns 409 for an expired quote from %s", async (action) => {
    const response = await actionPost(request({ quoteId, cartVersion: 15 }), context(action));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "QUOTE_EXPIRED", message, task: failed });
    expect(mocks.action).toHaveBeenCalledTimes(1);
  });

  it("returns 409 and a readable error for natural-language confirmation", async () => {
    const response = await messagePost(request({ query: "帮我下单", idempotencyKey: taskId, taskId, quote: { quoteId, cartVersion: 15 } }));
    expect(response.status).toBe(409);
    await expect(readApiResponse(response, "请求失败")).rejects.toMatchObject({
      name: "ApiRequestError", status: 409, code: "QUOTE_EXPIRED", message,
    } satisfies Partial<ApiRequestError>);
    expect(mocks.message).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["failed", "OUT_OF_STOCK", 409],
    ["failed", "AUTHORIZATION_REQUIRED", 403],
    ["failed", undefined, 503],
    ["reconciling_result", undefined, 503],
    ["canceled_link_failed", undefined, 503],
  ] as const)("maps %s / %s to %s", async (phase, errorCode, status) => {
    mocks.action.mockResolvedValue({ ...failed, phase, errorCode });
    const response = await actionPost(request({}), context("advance"));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ message, task: { phase } });
  });

  it.each(["awaiting_confirmation", "ordered", "needs_clarification"] as const)(
    "keeps a valid %s response successful", async (phase) => {
      mocks.action.mockResolvedValue({ ...failed, phase, error: undefined, errorCode: undefined });
      const response = await actionPost(request({}), context("advance"));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ task: { phase } });
    },
  );

  it("preserves 202 for task creation", async () => {
    const response = await createPost(request({ query: "找蓝牙耳机", idempotencyKey: taskId }));
    expect(response.status).toBe(202);
  });

  it("rejects unauthenticated actions before executing them", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await actionPost(request({}), context("advance"));
    expect(response.status).toBe(401);
    expect(mocks.action).not.toHaveBeenCalled();
  });
});
