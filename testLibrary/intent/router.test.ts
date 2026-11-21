import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ command: vi.fn(), contextual: vi.fn(), catalog: vi.fn(), parse: vi.fn() }));
vi.mock("@/lib/intent/rules", () => ({ routeExactCommand: mocks.command, routeExactCatalogSubject: mocks.catalog }));
vi.mock("@/lib/intent/context", () => ({ resolveSearchContext: mocks.contextual }));
vi.mock("@/lib/intent/model-parser", () => ({ parseModelIntent: mocks.parse }));
import { isSearchResolution, resolveAssistantIntent } from "@/lib/intent/router";
import { context, dialogue, intent, routing } from "./fixtures";

beforeEach(() => { vi.resetAllMocks(); });
describe("INT-ROUTE: 分层短路与搜索准入", () => {
  it("空输入直接澄清，不调用任何层", async () => {
    expect((await resolveAssistantIntent(" \n ")).routing.reason).toBe("empty_query");
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });
  it("精确命令优先且不解析商品", async () => {
    mocks.command.mockReturnValue(routing({ engine: "rules", action: "cancel_task" }));
    expect((await resolveAssistantIntent("取消")).routing.action).toBe("cancel_task");
    expect(mocks.contextual).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it.each(["contextual", "catalog"] as const)("%s 命中后不再请求模型", async (layer) => {
    if (layer === "contextual") mocks.contextual.mockReturnValue({ intent: intent(), routing: routing({ action: "fill_slot" }) });
    else mocks.catalog.mockResolvedValue({ intent: intent(), routing: routing() });
    const result = await resolveAssistantIntent("测试", [], context());
    expect(result.intent.keywords).toEqual(["充电宝"]);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it.each([undefined, context()])("有无对话上下文都只进行一次模型解析：%j", async (state) => {
    mocks.parse.mockResolvedValue({ intent: intent(), decision: { action: "new_search", confidence: 0.9 } });
    const history = [{ query: "找商品", intentSummary: "已筛选充电宝" }];
    await resolveAssistantIntent("找一个适合旅行的包", history, state);
    expect(mocks.parse).toHaveBeenCalledExactlyOnceWith("找一个适合旅行的包", history, state);
  });
  it.each(["chat", "clarify", "analyze_reviews", "query_status", "confirm_order", "cancel_task"] as const)("模型一次返回%s，不合并历史或保留夹带的搜索字段", async (action) => {
    mocks.parse.mockResolvedValue({
      intent: intent({ maxPrice: 100, productIds: ["invented"] }),
      edits: [{ field: "maxPrice", operation: "clear", evidence: "取消预算" }],
      decision: { action, confidence: 0.99, reviewMode: action === "analyze_reviews" ? "continue" : undefined },
    });
    const result = await resolveAssistantIntent("上下文消息", [], context());
    expect(result.intent).toEqual({ keywords: [], inStockOnly: false });
    expect(result.routing).toMatchObject({ action, engine: "llm", reason: "structured_intent_parser" });
    expect(result.routing.reviewMode).toBe(action === "analyze_reviews" ? "continue" : undefined);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(isSearchResolution(result)).toBe(false);
  });
  it("搜索低置信度不追加另一轮模型调用", async () => {
    mocks.parse.mockResolvedValue({ intent: intent(), decision: { action: "refine_search", confidence: 0.7 } });
    const result = await resolveAssistantIntent("模糊的追加要求", [], context());
    expect(isSearchResolution(result)).toBe(false);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });
  it("闲聊未提供reply时保留默认引导", async () => {
    mocks.parse.mockResolvedValue({ intent: intent(), decision: { action: "chat", confidence: 1 } });
    expect((await resolveAssistantIntent("你好呀", [], context())).reply).toContain("告诉我想买的商品");
  });
  it("新搜索不继承旧预算和排除条件，也不接受模型商品编号", async () => {
    mocks.parse.mockResolvedValue({ intent: intent({ keywords: ["咖啡"], productIds: ["invented"] }), decision: { action: "new_search", confidence: 0.9 } });
    const result = await resolveAssistantIntent("换个需求", [], context({ dialogue: dialogue({ intent: intent({ maxPrice: 100, excludeTerms: ["白色"] }) }) }));
    expect(result.intent.keywords).toEqual(["咖啡"]);
    expect(result.intent.maxPrice).toBeUndefined();
    expect(result.intent.excludeTerms).toBeUndefined();
    expect(result.intent.productIds).toBeUndefined();
  });
  it("补充搜索继承预算及必须条件", async () => {
    mocks.parse.mockResolvedValue({ intent: intent({ keywords: [], maxPrice: 300 }), decision: { action: "refine_search", confidence: 0.9 } });
    const result = await resolveAssistantIntent("预算改成300", [], context({ dialogue: dialogue({ intent: intent({ requiredConditions: ["快充"] }) }) }));
    expect(result.intent).toMatchObject({ keywords: ["充电宝"], maxPrice: 300, requiredConditions: ["快充"] });
  });
  it("BUG-I03：本轮预算和继承后预算有冲突时都只能澄清", async () => {
    mocks.parse.mockResolvedValue({ intent: intent({ minPrice: 1000, maxPrice: 500 }), decision: { action: "new_search", confidence: 1 } });
    const first = await resolveAssistantIntent("至少1000最多500");
    expect(first.routing.action).toBe("clarify");
    expect(isSearchResolution(first)).toBe(false);
    mocks.parse.mockResolvedValue({ intent: intent({ maxPrice: 500 }), decision: { action: "refine_search", confidence: 1 } });
    const second = await resolveAssistantIntent("最多500", [], context({ dialogue: dialogue({ intent: intent({ minPrice: 1000 }) }) }));
    expect(second.routing.action).toBe("clarify");
  });
  it("模型不可用时澄清，禁止空条件搜索", async () => {
    expect(await resolveAssistantIntent("复杂描述")).toMatchObject({ routing: { action: "clarify", confidence: 0, reason: "model_unavailable" } });
  });
  it("追加规格上限保留历史下限，合并后冲突必须澄清", async () => {
    mocks.parse.mockResolvedValue({
      intent: intent({ keywords: [], numericConstraints: [{ attribute: "容量", operator: "lte", value: 10000, unit: "mAh" }] }),
      decision: { action: "refine_search", confidence: 1 },
    });
    const result = await resolveAssistantIntent("容量最多10000mAh", [], context({ dialogue: dialogue({
      intent: intent({ numericConstraints: [{ attribute: "容量", operator: "gte", value: 20000, unit: "mAh" }] }),
    }) }));
    expect(result.intent.numericConstraints).toHaveLength(2);
    expect(result.routing).toMatchObject({ action: "clarify", reason: "conflicting_numeric_constraints" });
    expect(isSearchResolution(result)).toBe(false);
  });
  it("新搜索与可信补槽都不能绕过数值区间冲突检查", async () => {
    const conflicting = intent({ numericConstraints: [
      { attribute: "容量", operator: "gte", value: 20000, unit: "mAh" },
      { attribute: "容量", operator: "lte", value: 10000, unit: "mAh" },
    ] });
    mocks.parse.mockResolvedValue({ intent: conflicting, decision: { action: "new_search", confidence: 1 } });
    expect((await resolveAssistantIntent("找容量冲突的商品")).routing.action).toBe("clarify");
    mocks.contextual.mockReturnValue({ intent: conflicting, routing: routing({ engine: "state", action: "fill_slot" }) });
    expect((await resolveAssistantIntent("10000", [], context())).routing.action).toBe("clarify");
  });
  it("输入裁剪至1000字符再进入后续层", async () => {
    await resolveAssistantIntent("x".repeat(1100));
    expect(mocks.command).toHaveBeenCalledWith("x".repeat(1000));
    expect(mocks.parse.mock.calls[0][0]).toHaveLength(1000);
  });
  it.each([[0.79, false], [0.8, true], [1, true]])("搜索准入置信度边界 %s", (confidence, allowed) => {
    expect(isSearchResolution({ intent: intent(), routing: routing({ confidence: Number(confidence) }) })).toBe(allowed);
  });
});
