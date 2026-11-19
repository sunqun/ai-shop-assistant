import type { ProductSearchIntent } from "@/lib/catalog";

const MAX_QUERY_LENGTH = 1000;
const MAX_TERMS = 12;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, MAX_TERMS);
}

function extractFallbackTerms(query: string): string[] {
  // 当模型没有提取出商品词时，只从常见搜索动作词之后保留短商品短语，避免把整句自然语言直接交给 SQL。
  const match = query.match(
    /(?:要买|想买|购买|买|寻找|找|需要|推荐|查找|搜索|有没有|有无|是否有|有)([\u4e00-\u9fffA-Za-z0-9][\u4e00-\u9fffA-Za-z0-9\s-]{0,30})/u
  );
  const candidateSource = match?.[1] ?? query;
  const candidate = candidateSource
    .replace(/[，。！？、；：:,.!?;].*$/u, "")
    .trim()
    .replace(
      /^(我|要|想|买|购买|寻找|找|需要|推荐|查找|搜索|有没有|有无|是否有|有|一下|一些|一个|一款|相关的?)/u,
      ""
    )
    .replace(/(吗|呢|呀|啊)$/u, "")
    .trim();
  if (candidate.length < 2 || candidate.length > 24) return [];
  return [candidate];
}

function normalizeSearchTerms(terms: string[]): string[] {
  // 保留用户原词；常见简称由目录别名表扩展，避免在 Agent 层硬编码商品名称。
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, MAX_TERMS);
}

function applyQueryFallback(intent: ProductSearchIntent, query: string): ProductSearchIntent {
  const fallbackTerms = extractFallbackTerms(query).filter(
    (term) => !intent.keywords.includes(term)
  );
  if (!fallbackTerms.length) return intent;

  // 模型偶尔会把“有没有”“我要买”等问法一起放进关键词；这类词会导致真实商品字段无法命中。
  const hasWrappedKeyword = intent.keywords.some(
    (term) =>
      /^(我|要|想|买|购买|寻找|找|需要|推荐|查找|搜索|有没有|有无|是否有|有)/u.test(term) ||
      term.includes(query)
  );
  if (
    hasWrappedKeyword ||
    (!intent.keywords.length && !intent.specTerms.length && !intent.category && !intent.brand)
  ) {
    return { ...intent, keywords: normalizeSearchTerms(fallbackTerms) };
  }
  return intent;
}

function fallbackIntent(query: string): ProductSearchIntent {
  return {
    keywords: extractFallbackTerms(query),
    specTerms: [],
    inStockOnly: false,
  };
}

function normalizeIntent(value: unknown): ProductSearchIntent {
  // 模型输出只作为候选条件，先做类型、长度和数值范围校验，再交给数据库查询。
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const keywords = stringList(source.keywords);
  const category =
    typeof source.category === "string"
      ? source.category.trim().slice(0, 80) || undefined
      : undefined;
  const minPrice = clampNumber(source.minPrice, 0, 10_000_000);
  const maxPrice = clampNumber(source.maxPrice, 0, 10_000_000);
  const normalizedMin =
    minPrice !== undefined && maxPrice !== undefined ? Math.min(minPrice, maxPrice) : minPrice;
  const normalizedMax =
    minPrice !== undefined && maxPrice !== undefined ? Math.max(minPrice, maxPrice) : maxPrice;
  return {
    keywords,
    // 同一词被模型重复标成品类和商品词时，只保留商品词；否则数据库会再要求分类名也匹配该词。
    category:
      category &&
      keywords.some((keyword) => keyword.toLocaleLowerCase() === category.toLocaleLowerCase())
        ? undefined
        : category,
    brand:
      typeof source.brand === "string" ? source.brand.trim().slice(0, 80) || undefined : undefined,
    minPrice: normalizedMin,
    maxPrice: normalizedMax,
    minRating: clampNumber(source.minRating, 0, 5),
    inStockOnly: source.inStockOnly === true,
    specTerms: stringList(source.specTerms),
  };
}

function extractJson(content: string): unknown {
  // 兼容少数兼容接口仍会包裹 markdown 代码块的情况，但不放宽后续字段校验。
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("LLM returned invalid intent JSON");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function baseUrl(): string {
  return requiredEnv("MODEL_BASE_URL").replace(/\/$/, "").endsWith("/chat/completions")
    ? requiredEnv("MODEL_BASE_URL").replace(/\/$/, "")
    : `${requiredEnv("MODEL_BASE_URL").replace(/\/$/, "")}/chat/completions`;
}

export type ProductSearchMode = "model" | "fallback";

export async function parseProductSearchIntentWithMode(
  query: string
): Promise<{ intent: ProductSearchIntent; searchMode: ProductSearchMode }> {
  console.log("parseProductSearchIntentWithMode", query);
  const normalizedQuery = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!normalizedQuery) {
    return {
      intent: { keywords: [], specTerms: [], inStockOnly: false },
      searchMode: "fallback",
    };
  }

  // LLM 只负责把自然语言转换成结构化条件，不接触商品数据和内部推荐字段。
  try {
    const response = await fetch(baseUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requiredEnv("DEEPSEEK_API_KEY")}`,
      },
      body: JSON.stringify({
        model: requiredEnv("MODEL"),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是商品搜索意图解析器。只输出 JSON，不回答用户问题，不推荐商品，不访问数据库。字段必须是 keywords(string[]), category(string|null), brand(string|null), minPrice(number|null), maxPrice(number|null), minRating(number|null), inStockOnly(boolean), specTerms(string[])。只提取用户明确表达的商品、品类、品牌、预算、评分、库存和规格要求；不要编造字段。",
          },
          { role: "user", content: normalizedQuery },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`LLM request failed with status ${response.status}`);
    const data: unknown = await response.json();
    const content =
      data &&
      typeof data === "object" &&
      "choices" in data &&
      Array.isArray(data.choices) &&
      data.choices[0] &&
      typeof data.choices[0] === "object" &&
      "message" in data.choices[0] &&
      data.choices[0].message &&
      typeof data.choices[0].message === "object" &&
      "content" in data.choices[0].message
        ? data.choices[0].message.content
        : null;
    if (typeof content !== "string") throw new Error("LLM response did not include intent content");
    return {
      intent: applyQueryFallback(normalizeIntent(extractJson(content)), normalizedQuery),
      searchMode: "model",
    };
  } catch (error) {
    // 模型暂不可用时仅允许短商品词降级检索，查询仍走真实目录数据库。
    const degraded = fallbackIntent(normalizedQuery);
    if (!degraded.keywords.length) throw error;
    return { intent: degraded, searchMode: "fallback" };
  }
}

export async function parseProductSearchIntent(query: string): Promise<ProductSearchIntent> {
  const { intent } = await parseProductSearchIntentWithMode(query);
  return intent;
}

export function makeIntentSummary(intent: ProductSearchIntent): string {
  const parts = [
    intent.category,
    intent.brand,
    intent.keywords.join("、"),
    intent.specTerms.join("、"),
    intent.minPrice !== undefined || intent.maxPrice !== undefined
      ? `${intent.minPrice ?? 0}-${intent.maxPrice ?? "不限"} ${"元"}`
      : undefined,
    intent.inStockOnly ? "有库存" : undefined,
  ].filter(Boolean);
  return parts.length ? `已按“${parts.join("，")}”筛选` : "已按你的描述查找相关商品";
}
