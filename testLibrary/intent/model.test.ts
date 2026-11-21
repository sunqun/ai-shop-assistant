import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/llm", () => ({ createLLMFromEnv: () => ({ invoke: mocks.invoke }) }));
vi.mock("@/lib/intent/rules", () => ({ routeExactCommand: () => undefined, routeExactCatalogSubject: async () => undefined }));
import { parseModelIntent } from "@/lib/intent/model-parser";
import { intentTool } from "@/lib/intent/model-schema";
import { validateIntentEdits } from "@/lib/intent/intent-edits";
import { resolveAssistantIntent, isSearchResolution } from "@/lib/intent/router";
import { z } from "zod";
import { context, dialogue, intent } from "./fixtures";

beforeEach(() => { vi.resetAllMocks(); });
describe("INT-MODEL: 模型边界；全部模拟，不访问模型", () => {
  it.each([
    { action: "chat", query: "先聊一聊你可以帮我做些什么" },
    { action: "clarify", query: "我还没想好想要哪种" },
    { action: "query_status", query: "刚才那项任务是不是已经取消了" },
    { action: "confirm_order", query: "那麻烦你帮我提交这件商品吧" },
    { action: "cancel_task", query: "那麻烦你停一下刚才的购买流程吧" },
    { action: "analyze_reviews", query: "刚才那3条评论还没读完，接着分析吧" },
  ] as const)("非搜索动作$action省略搜索字段，也只调用一次模型", async ({ action, query }) => {
    mocks.invoke.mockImplementation(async (_messages, tools) => ({
      toolResult: await tools.parse_product_search_intent.execute({ action, confidence: 1 }),
    }));
    const result = await resolveAssistantIntent(query, [], context());
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][3]).toMatchObject({ toolChoiceName: "parse_product_search_intent", temperature: 0 });
    expect(result.routing).toMatchObject({ action, engine: "llm" });
    expect(result.intent).toEqual({ keywords: [], inStockOnly: false });
    expect(isSearchResolution(result)).toBe(false);
  });
  it.each(["reuse", "continue", "refresh"] as const)("统一解析保留评论模式%s", async (reviewMode) => {
    mocks.invoke.mockImplementation(async (_messages, tools) => ({
      toolResult: await tools.parse_product_search_intent.execute({ action: "analyze_reviews", confidence: 1, reviewMode }),
    }));
    const result = await resolveAssistantIntent("请接着处理这件商品的评价", [], context());
    expect(result.routing.reviewMode).toBe(reviewMode);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("非评论动作不能携带refresh模式", async () => {
    const output = await intentTool.execute({ action: "chat", confidence: 1, reviewMode: "refresh" });
    expect(output.decision.reviewMode).toBeUndefined();
  });
  it("非搜索动作不校验搜索规格，也不携带夹带的条件与编辑", async () => {
    mocks.invoke.mockResolvedValue({ toolResult: {
      intent: intent({ numericConstraints: [{ attribute: "容量", operator: "gte", value: 20000, unit: "mAh" }], quantity: 3 }),
      decision: { action: "analyze_reviews", confidence: 1, reviewMode: "reuse" },
      edits: [{ field: "maxPrice", operation: "clear", evidence: "取消预算" }],
    } });
    const result = await parseModelIntent("不用重读那3条评论，只聊体验", [], context());
    expect(result?.intent).toEqual({ keywords: [], inStockOnly: false });
    expect(result?.edits).toBeUndefined();
    expect(result?.decision).toMatchObject({ action: "analyze_reviews", reviewMode: "reuse" });
  });
  it("模型超时只返回澄清，不调用第二个分类或解析模型", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.invoke.mockRejectedValue(new Error("timeout"));
      const result = await resolveAssistantIntent("刚才的任务处理得怎么样了", [], context());
      expect(result.routing).toMatchObject({ action: "clarify", confidence: 0, reason: "model_unavailable" });
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });
  it("完整解析保留历史消息，并使用强制结构化工具", async () => {
    mocks.invoke.mockResolvedValue({ toolResult: { intent: intent(), decision: { action: "new_search", confidence: 1 } } });
    const history = [{ query: "找充电宝", intentSummary: "已按充电宝筛选" }];
    expect((await parseModelIntent("要蓝色", history, context()))?.intent.keywords).toEqual(["充电宝"]);
    const [messages, tools, signal, options] = mocks.invoke.mock.calls[0];
    expect(messages.slice(1)).toEqual([
      { role: "user", content: history[0].query },
      { role: "assistant", content: history[0].intentSummary },
      { role: "user", content: "要蓝色" },
    ]);
    expect(tools.parse_product_search_intent).toBe(intentTool);
    expect(signal).toBeDefined();
    expect(options).toMatchObject({ toolChoiceName: "parse_product_search_intent", temperature: 0 });
  });
  it("完整模型异常时返回未解析", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.invoke.mockRejectedValue(new Error("offline"));
      expect(await parseModelIntent("找咖啡", [])).toBeUndefined();
    } finally { log.mockRestore(); }
  });
  it("模型实体字段归一化且不接受商品编号或内部排序参数", async () => {
    const output = await intentTool.execute({
      action: "new_search", confidence: 1, keywords: ["耳机", "黑色"], excludeTerms: ["黑色"],
      category: "耳机", minRating: 4.5, productIds: ["invented"], internal_rank: 999,
    });
    expect(output.intent).toMatchObject({ keywords: ["耳机"], minRating: 4.5 });
    expect(output.intent.category).toBeUndefined();
    expect(output.intent).not.toHaveProperty("productIds");
    expect(output.intent).not.toHaveProperty("internal_rank");
  });
  it.each([
    { action: "refund", confidence: 1 },
    { confidence: 1 },
    { action: "new_search" },
    { action: "new_search", confidence: "sure" },
    { action: "new_search", confidence: 1.1 },
  ])("未知动作、缺失决策或非法置信度必须拒绝：%j", async (decision) => {
    await expect(intentTool.execute({ ...decision, keywords: ["耳机"] })).rejects.toThrow();
  });
  it.each([
    { maxPrice: "500" }, { minPrice: -1 }, { maxPrice: 10_000_001 },
    { minRating: 8 }, { minRating: NaN }, { maxPrice: Infinity },
    { requiredConditions: "快充" }, { excludeBrands: ["Fixture", 123] },
    { inStockOnly: "true" }, { keywords: ["耳机", null] },
    { requiredConditions: [" "] }, { excludeTerms: ["x".repeat(81)] },
    { excludeTerms: Array.from({ length: 13 }, (_, index) => `限制${index}`) },
    { numericConstraints: [{ attribute: "容量", operator: "gte", value: -1 }] },
    { numericConstraints: [{ attribute: "容量", operator: "gt", value: 20000 }] },
    { numericConstraints: [{ attribute: "容量", operator: "gte", value: 20000, unit: "x".repeat(21) }] },
  ])("非法条件不能被丢弃或截成合法值：%j", async (fields) => {
    await expect(intentTool.execute({ action: "new_search", confidence: 1, keywords: ["耳机"], ...fields })).rejects.toThrow();
  });
  it("未提及的条件可以省略或用可空标量表示，合法的零值必须保留", async () => {
    const output = await intentTool.execute({ action: "new_search", confidence: 1, maxPrice: 0, minRating: 0, brand: null });
    expect(output.intent).toMatchObject({ keywords: [], inStockOnly: false, maxPrice: 0, minRating: 0 });
    expect(output.intent.brand).toBeUndefined();
  });
  it("工具声明将动作与置信度列为必填字段", () => {
    const schema = z.toJSONSchema(intentTool.inputSchema);
    expect(schema.required).toEqual(expect.arrayContaining(["action", "confidence"]));
    expect(schema.required).not.toContain("maxPrice");
  });
  it.each([
    { action: "refund", confidence: 1, keywords: ["耳机"] },
    { action: "new_search", confidence: 1, keywords: ["耳机"], maxPrice: "500" },
  ])("模型返回非法结果时路由只能澄清，不能创建宽泛搜索：%j", async (args) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.invoke.mockImplementation(async () => ({ toolResult: await intentTool.execute(args) }));
      const result = await resolveAssistantIntent("找500元以内的耳机");
      expect(result.routing).toMatchObject({ action: "clarify", confidence: 0 });
      expect(isSearchResolution(result)).toBe(false);
    } finally { log.mockRestore(); }
  });
  it.each([[30000, "refine_search"], [10000, "clarify"]] as const)("仅返回本轮容量上限%s，经过工具校验和历史合并后路由为%s", async (upper, action) => {
    const evidence = `容量最多${upper}mAh`;
    mocks.invoke.mockImplementation(async (_messages, tools) => ({
      toolResult: await tools.parse_product_search_intent.execute({
        action: "refine_search", confidence: 1,
        numericConstraints: [{ attribute: "容量", operator: "lte", value: upper, unit: "mAh", evidence }],
      }),
    }));
    const result = await resolveAssistantIntent(evidence, [], context({ dialogue: dialogue({ intent: intent({
      maxPrice: 500, requiredConditions: ["快充"], excludeTerms: ["翻新"],
      numericConstraints: [{ attribute: "容量", operator: "gte", value: 20000, unit: "mAh" }],
    }) }) }));
    expect(result.intent).toMatchObject({ keywords: ["充电宝"], maxPrice: 500, requiredConditions: ["快充"], excludeTerms: ["翻新"] });
    expect(result.intent.numericConstraints).toHaveLength(2);
    expect(result.routing.action).toBe(action);
    expect(isSearchResolution(result)).toBe(action === "refine_search");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("BUG-I03：保留矛盾预算，不静默交换上下限", async () => {
    const output = await intentTool.execute({ action: "new_search", confidence: 1, minPrice: 1000, maxPrice: 500 });
    expect(output.intent).toMatchObject({ minPrice: 1000, maxPrice: 500 });
  });
  it("撤销操作必须引用本轮明确修改原话", () => {
    expect(validateIntentEdits([{ field: "maxPrice", operation: "clear", evidence: "取消预算上限" }], "取消预算上限")).toHaveLength(1);
    expect(validateIntentEdits([{ field: "maxPrice", operation: "clear", evidence: "取消预算上限" }], "要蓝色的")).toEqual([]);
    expect(validateIntentEdits([{ field: "maxPrice", operation: "clear", evidence: "要蓝色的" }], "要蓝色的")).toEqual([]);
  });
});
