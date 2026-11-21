// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/repository/db", () => ({ getDbPool: () => ({ query: mocks.query }) }));
import { routeExactCatalogSubject, routeExactCommand } from "@/lib/intent/rules";

beforeEach(() => { mocks.query.mockReset(); });
describe("INT-RULE: 精确命令和唯一目录主体", () => {
  it.each(["确认下单", "確認購買", "  确认下单！  "])("明确完整命令：%s", (query) => {
    expect(routeExactCommand(query)).toMatchObject({ action: "confirm_order", confidence: 1, engine: "rules" });
  });
  it.each(["不要确认下单", "确认下单？", "可以取消吗", "取消了吗", "先不取消", "取消并找耳机", "商品叫确认下单"])("不把否定/询问/组合句当命令：%s", (query) => {
    expect(routeExactCommand(query)).toBeUndefined();
  });
  it.each(["取消", "取消下单", "不要買了"])("取消精确命令：%s", (query) => {
    expect(routeExactCommand(query)?.action).toBe("cancel_task");
  });
  it.each([
    ["看看差评", "reuse"], ["继续分析评论", "continue"], ["重新分析評論", "refresh"],
  ])("评论模式：%s", (query, reviewMode) => {
    expect(routeExactCommand(query)).toMatchObject({ action: "analyze_reviews", reviewMode });
  });
  it("别名对应同一标准词时可确定主体，SQL 参数绑定", async () => {
    mocks.query.mockResolvedValue([[{ canonical_term: "行动电源" }, { canonical_term: "行动电源" }]]);
    expect(await routeExactCatalogSubject("帮我找充电宝")).toMatchObject({
      routing: { action: "new_search", reason: "unique_catalog_subject" },
      intent: { keywords: ["行动电源"] },
    });
    expect(mocks.query.mock.calls[0][1]).toEqual(["充电宝", "充电宝", "充电宝"]);
  });
  it.each([{ rows: [] }, { rows: [{ canonical_term: "A" }, { canonical_term: "B" }] }])("零个或多个目录主体不猜测：%j", async ({ rows }) => {
    mocks.query.mockResolvedValue([rows]);
    expect(await routeExactCatalogSubject("测试主体")).toBeUndefined();
  });
  it.each(["它", "刚才那个", "充电宝，至少20000mAh", "耳机？", "a", "长".repeat(61)])("不以指代或复杂请求走精确目录：%s", async (query) => {
    expect(await routeExactCatalogSubject(query)).toBeUndefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("数据库不可用时回退", async () => {
    mocks.query.mockRejectedValue(new Error("offline"));
    expect(await routeExactCatalogSubject("充电宝")).toBeUndefined();
  });
});
