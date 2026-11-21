// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "@/lib/llm/type";
import type { ProductRow } from "@/lib/catalog/shared";

const mocks = vi.hoisted(() => ({ query: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/repository/db", () => ({
  getDbPool: () => ({ query: mocks.query }),
}));
vi.mock("@/lib/llm", () => ({
  createLLMFromEnv: () => ({ invoke: mocks.invoke }),
}));
import { POST } from "@/app/api/v1/assistant/search/route";

// 使用实际种子别名，不在 mock 里另写一份正确映射掩盖数据错误。
const seed = readFileSync(new URL("../../db/dml.sql", import.meta.url), "utf8");
const aliases = [...seed.matchAll(
  /INSERT IGNORE INTO product_search_aliases \(alias, canonical_term\) VALUES\s*([\s\S]*?);/gu,
)].flatMap((block) => [...block[1].matchAll(/\('([^']+)', '([^']+)'\)/gu)]
  .map((match) => ({ alias: match[1], canonical_term: match[2] })));

function product(id: string, name: string, description: string, specs: Record<string, string>): ProductRow {
  return {
    product_id: id, name, description, specs, brand: "Pulso", category: "3C 配件",
    category_id: "3c-accessories", tone: "office", price: 4290, currency: "TWD",
    stock: 9, rating: 4.5, review_count: 1, margin_rate: 0.4, internal_rank: 100,
  } as ProductRow;
}
const products = [
  product("P005", "Studio 降噪頭戴式耳機", "主動降噪搭配耳罩式設計，長時間配戴也舒適。", { 降噪: "主動降噪（ANC）" }),
  product("P001", "Aero 無線藍牙耳機", "輕巧入耳式設計，通勤、運動都適用。", { 續航: "單次 6 小時" }),
  product("keyboard", "機械式鍵盤", "桌面使用", {}),
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockImplementation(async (sql: string, params: Array<string | number>) => {
    if (sql.includes("SELECT canonical_term FROM product_search_aliases")) {
      const subject = params[0];
      const terms = new Set([
        ...aliases.filter((row) => row.alias === subject || row.canonical_term === subject)
          .map((row) => row.canonical_term),
        ...products.filter((row) => row.name === subject).map((row) => row.name),
      ]);
      return [[...terms].slice(0, 2).map((canonical_term) => ({ canonical_term }))];
    }
    if (sql.includes("FROM product_search_aliases")) {
      return [aliases.filter((row) => params.includes(row.alias) || params.includes(row.canonical_term))];
    }
    if (sql.includes("FROM products p")) {
      // 本组请求只有一个主体词组：组内别名按 SQL 的 OR 子串语义匹配。
      const terms = params.filter((value): value is string =>
        typeof value === "string" && value.startsWith("%") && value.endsWith("%"))
        .map((value) => value.slice(1, -1));
      return [products.filter((row) => terms.some((term) =>
        [row.name, row.brand, row.category, row.description, JSON.stringify(row.specs)]
          .some((value) => value.includes(term))))];
    }
    throw new Error("Unexpected database query in headphone search regression");
  });
  mocks.invoke.mockImplementation(async (_messages, tools: Record<string, Tool>) => {
    if (tools.parse_product_search_intent) {
      return { toolResult: await tools.parse_product_search_intent.execute({
        action: "new_search", confidence: 1, keywords: ["耳机"],
        requiredConditions: ["降噪"], preferences: ["通勤使用"],
      }) };
    }
    const request = JSON.parse(_messages.at(-1).content);
    return { toolResult: await tools.assess_catalog_conditions.execute({
      assessments: request.pending.map((item: { productId: string; conditionId: string }) => ({
        ...item,
        verdict: item.productId === "P005" && item.conditionId === "required:0" ? "matched" : "unknown",
        evidence: item.productId === "P005" && item.conditionId === "required:0" ? "主動降噪（ANC）" : "",
      })),
    }) };
  });
});

async function search(query: string) {
  const response = await POST(new Request("http://localhost/api/v1/assistant/search", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, pageSize: 20 }),
  }));
  expect(response.status).toBe(200);
  return response.json();
}

describe("耳机别名：HTTP → 意图路由 → MCP → 目录查询（模拟数据库和模型）", () => {
  it.each(["耳机", "耳機", "耳機子"])("通用词 %s 同时覆盖蓝牙和头戴式商品", async (query) => {
    const result = await search(query);
    expect(result.products.map((row: { id: string }) => row.id)).toEqual(["P005", "P001"]);
    expect(result.routing).toMatchObject({ engine: "rules", action: "new_search" });
    expect(result.intentSummary).toContain("耳機");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("通勤降噪耳机拆成主体和条件后仍能召回 Studio，保留待核实偏好", async () => {
    const result = await search("通勤降噪耳机");
    expect(result.products.map((row: { id: string }) => row.id)).toContain("P005");
    expect(result.products.map((row: { id: string }) => row.id)).not.toContain("keyboard");
    expect(result.intentSummary).toContain("降噪");
    expect(result.clarificationContext).toMatchObject({
      unresolvedRequired: [], unresolvedPreferences: ["通勤使用"],
    });
    expect(result.clarification).toContain("通勤使用");
  });

  it.each([
    ["蓝牙耳机", ["P001"]],
    ["降噪耳机", ["P005"]],
    ["头戴式耳机", ["P005"]],
    ["Studio 降噪頭戴式耳機", ["P005"]],
  ])("具体主体 %s 保留原有检索范围", async (query, ids) => {
    const result = await search(query);
    expect(result.products.map((row: { id: string }) => row.id)).toEqual(ids);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
