import { afterEach, describe, expect, it, vi } from "vitest";
import { makeIntentSummary, parseProductSearchIntent } from "@/lib/assistant-agent";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("assistant product search intent", () => {
  it("does not let a duplicated category term filter out matching products", async () => {
    vi.stubEnv("MODEL_BASE_URL", "https://model.test/v1");
    vi.stubEnv("MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        keywords: ["咖啡"],
        category: "咖啡",
        brand: null,
        minPrice: null,
        maxPrice: null,
        minRating: null,
        inStockOnly: false,
        specTerms: [],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const intent = await parseProductSearchIntent("我要买咖啡");

    expect(intent.keywords).toEqual(["咖啡"]);
    expect(intent.category).toBeUndefined();
    expect(makeIntentSummary(intent)).toContain("咖啡");
  });
});
