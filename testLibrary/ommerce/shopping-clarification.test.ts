import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "@/lib/shop-task/shopping-task-store";
import type { CatalogProduct } from "@/lib/catalog";
import { TERMINAL_PHASES } from "@/lib/shop-task/shopping-task-types";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), order: vi.fn(), link: vi.fn(), task: undefined as TaskRecord | undefined }));
vi.mock("@/lib/agent/auto-shopping", () => ({ runShoppingReAct: mocks.prepare }));
vi.mock("@/lib/repository/order-service", async (original) => ({ ...(await original<object>()), submitAiOrder: mocks.order }));
vi.mock("@/lib/repository/payment-link-service", () => ({ createPaymentLink: mocks.link }));
vi.mock("@/lib/shop-task/shopping-task-store", async (original) => ({
  ...(await original<object>()),
  getTask: async () => mocks.task!,
  updateTask: async (_userid: string, _taskId: string, mutate: (record: TaskRecord) => void) => {
    const record = mocks.task!;
    mutate(record);
    record.revision += 1;
    if (TERMINAL_PHASES.includes(record.phase)) record.activeUser = null;
    return record;
  },
}));
import { actOnShoppingTask } from "@/lib/shop-task/shopping-task-service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.task = { taskId: "clarification-task", userid: "fixture-user", query: "大容量快充充电宝",
    phase: "queued", revision: 0, data: {}, commitAfter: null, operationToken: null,
    operationStartedAt: null, activeUser: "fixture-user" };
});

describe("shopping task clarification", () => {
  it("finishes unresolved input clarification without an order deadline", async () => {
    const product = { id: "P003", name: "輕量行動電源 10000mAh" } as CatalogProduct;
    const message = "找到10000mAh快充充电宝，请明确容量标准。";
    mocks.prepare.mockResolvedValue({ status: "needs_clarification", product, message });
    // 通常 onProgress 先持久化候选；结果回写也应保留候选，不依赖模型走到 final_answer。
    mocks.task!.data.product = product;
    const result = await actOnShoppingTask("fixture-user", "clarification-task", "advance");
    expect(result).toMatchObject({ phase: "needs_clarification", terminal: true, canAdvance: false,
      canConfirm: false, canCancel: false, clarification: message, product, commitAfter: null });
    expect(mocks.task!.activeUser).toBeNull();
    expect(mocks.task!.operationToken).toBeNull();
    expect(result.error).toBeUndefined();
    await actOnShoppingTask("fixture-user", "clarification-task", "advance");
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.order).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
  });
});
