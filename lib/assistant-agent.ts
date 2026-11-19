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
  const excludeTerms = stringList(source.excludeTerms);
  const excludeBrands = stringList(source.excludeBrands);
  const excludeCategories = stringList(source.excludeCategories);
  const excluded = new Set(
    [...excludeTerms, ...excludeBrands, ...excludeCategories].map((term) =>
      term.toLocaleLowerCase()
    )
  );
  const keywords = stringList(source.keywords).filter(
    (keyword) => !excluded.has(keyword.toLocaleLowerCase())
  );
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
    excludeTerms,
    excludeBrands,
    excludeCategories,
  };
}

function baseUrl(): string {
  return requiredEnv("MODEL_BASE_URL").replace(/\/$/, "").endsWith("/chat/completions")
    ? requiredEnv("MODEL_BASE_URL").replace(/\/$/, "")
    : `${requiredEnv("MODEL_BASE_URL").replace(/\/$/, "")}/chat/completions`;
}

const INTENT_TOOL = {
  type: "function",
  function: {
    name: "parse_product_search_intent",
    description:
      "解析用户商品搜索意图，输出结构化筛选条件；不回答用户问题、不推荐商品、不访问数据库。",
    parameters: {
      type: "object",
      properties: {
        keywords: { type: "array", items: { type: "string" } },
        category: { type: ["string", "null"] },
        brand: { type: ["string", "null"] },
        minPrice: { type: ["number", "null"] },
        maxPrice: { type: ["number", "null"] },
        minRating: { type: ["number", "null"] },
        inStockOnly: { type: "boolean" },
        specTerms: { type: "array", items: { type: "string" } },
        excludeTerms: { type: "array", items: { type: "string" } },
        excludeBrands: { type: "array", items: { type: "string" } },
        excludeCategories: { type: "array", items: { type: "string" } },
      },
      required: [
        "keywords",
        "inStockOnly",
        "specTerms",
        "excludeTerms",
        "excludeBrands",
        "excludeCategories",
      ],
    },
  },
};

function buildIntentSystemPrompt(): string {
  return [
    "你是商品搜索意图解析器。只做理解与结构化，不回答用户问题、不推荐商品、不访问数据库。",
    "核心原则：意图判断的是用户本轮想做什么操作，不是内容本身的性质。",
    "",
    "## 内容类型（先分域）",
    "- chat：闲聊/问候/超域，无商品诉求 → 返回空意图（keywords=[], specTerms=[], inStockOnly=false，排除字段全空）。",
    "- search：含商品/品类/品牌/预算/评分/库存/规格/排除诉求 → 进入意图类型与实体抽取。",
    "",
    "## 意图类型（再判操作，仅 search）",
    "- new（兜底）：新一轮直接找商品，未表达纠错/继承/补充。",
    "- supplement：在上一轮条件上追加（再加、还要、顺便、也）。",
    "- correct：纠错/否定，排除或替换条件（不要、不是、除了、换成、改成）→ 写入 excludeTerms/excludeBrands/excludeCategories。",
    "- inherit：指代/延续上一轮（它、那个、刚才的、上面的）→ 结合历史展开后输出合并意图。",
    "判定优先级：correct → supplement → inherit → 兜底 new。",
    "",
    "## 指代消解（结合历史）",
    "显式指代：它、这个、这些、那个、刚才的、上面的、之前说的商品或条件。",
    "隐式指代：动作暗含引用历史，如「再便宜一点」「只要蓝色的」「那个有没有黑色」。",
    "消解规则：",
    "- 无指代 → 只按本轮内容抽取，不继承历史条件。",
    "- 指代能唯一确定对象 → 展开为具体商品或条件，再与历史意图合并输出。",
    "- 指代无法唯一确定对象 → 不臆测，按本轮可确定部分抽取，降级为 new。",
    "展开示例：",
    "- 用户「那个有没有黑色」+ 历史「蓝牙耳机」→ keywords=[蓝牙耳机]，specTerms=[黑色]。",
    "- 用户「再便宜一点」+ 历史「蓝牙耳机 1000 元以内」→ keywords=[蓝牙耳机]，maxPrice 下调。",
    "- 用户「再加个蓝牙耳机」+ 历史「500 元以内」→ keywords=[蓝牙耳机]，maxPrice=500。",
    "",
    "## 实体抽取",
    "- 只提取用户明确表达的商品、品类、品牌、预算、评分、库存、规格和排除要求，不要编造字段。",
    "- 输出干净词，别名由目录别名表处理，不要硬编码商品别名。",
    "- 不把「有没有/我要买/想买」等问法词放进关键词。",
    "- 否定与纠错写 exclude*，正向诉求写 keywords/category/brand/specTerms；supplement/inherit 输出合并后的完整意图。",
  ].join("\n");
}

function extractToolArguments(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;
  const toolCalls = (message as Record<string, unknown>).tool_calls;
  if (!Array.isArray(toolCalls) || !toolCalls[0] || typeof toolCalls[0] !== "object") return null;
  const fn = (toolCalls[0] as Record<string, unknown>).function;
  if (!fn || typeof fn !== "object") return null;
  const args = (fn as Record<string, unknown>).arguments;
  return typeof args === "string" ? args : null;
}

export type ProductSearchMode = "model" | "fallback";

export type IntentHistoryTurn = { query: string; intentSummary: string };

export async function parseProductSearchIntentWithMode(
  query: string,
  history: IntentHistoryTurn[] = []
): Promise<{ intent: ProductSearchIntent; searchMode: ProductSearchMode }> {
  const normalizedQuery = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!normalizedQuery) {
    return {
      intent: { keywords: [], specTerms: [], inStockOnly: false },
      searchMode: "fallback",
    };
  }

  // LLM 只负责把自然语言转换成结构化条件，不接触商品数据和内部推荐字段。
  try {
    const historyMessages = history.flatMap((turn) => [
      { role: "user" as const, content: turn.query },
      { role: "assistant" as const, content: turn.intentSummary },
    ]);
    const response = await fetch(baseUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requiredEnv("DEEPSEEK_API_KEY")}`,
      },
      body: JSON.stringify({
        model: requiredEnv("MODEL"),
        temperature: 0,
        tools: [INTENT_TOOL],
        tool_choice: { type: "function", function: { name: "parse_product_search_intent" } },
        messages: [
          { role: "system", content: buildIntentSystemPrompt() },
          ...historyMessages,
          { role: "user", content: normalizedQuery },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`LLM request failed with status ${response.status}`);
    const data: unknown = await response.json();
    const argumentsText = extractToolArguments(data);
    if (argumentsText === null) throw new Error("LLM response did not include a tool call");
    return {
      intent: normalizeIntent(JSON.parse(argumentsText)),
      searchMode: "model",
    };
  } catch (error) {
    // 模型暂不可用时仅允许短商品词降级检索，查询仍走真实目录数据库。
    console.error(
      "parseProductSearchIntent failed, falling back to regex:",
      error instanceof Error ? error.message : error
    );
    const degraded = fallbackIntent(normalizedQuery);
    if (!degraded.keywords.length) throw error;
    return { intent: degraded, searchMode: "fallback" };
  }
}

export async function parseProductSearchIntent(query: string): Promise<ProductSearchIntent> {
  const { intent } = await parseProductSearchIntentWithMode(query);
  return intent;
}

export function isEmptyIntent(intent: ProductSearchIntent): boolean {
  return (
    !intent.keywords.length &&
    !intent.specTerms.length &&
    !intent.category &&
    !intent.brand &&
    intent.minPrice === undefined &&
    intent.maxPrice === undefined &&
    intent.minRating === undefined &&
    !intent.inStockOnly &&
    !intent.excludeTerms?.length &&
    !intent.excludeBrands?.length &&
    !intent.excludeCategories?.length
  );
}

export function mergeIntent(
  previous: ProductSearchIntent | undefined,
  current: ProductSearchIntent
): ProductSearchIntent {
  if (!previous) return current;
  // 本轮没有新增商品/品类/品牌词，视为对上一轮的条件补充 → 继承上一轮的检索主体。
  const hasNewSubject = current.keywords.length > 0 || !!current.category || !!current.brand;
  if (hasNewSubject) return current;
  return {
    keywords: previous.keywords,
    category: previous.category,
    brand: previous.brand,
    minPrice: current.minPrice ?? previous.minPrice,
    maxPrice: current.maxPrice ?? previous.maxPrice,
    minRating: current.minRating ?? previous.minRating,
    inStockOnly: current.inStockOnly || previous.inStockOnly,
    specTerms: [...new Set([...previous.specTerms, ...current.specTerms])],
    excludeTerms: [...new Set([...(previous.excludeTerms ?? []), ...(current.excludeTerms ?? [])])],
    excludeBrands: [...new Set([...(previous.excludeBrands ?? []), ...(current.excludeBrands ?? [])])],
    excludeCategories: [...new Set([...(previous.excludeCategories ?? []), ...(current.excludeCategories ?? [])])],
  };
}

export function makeIntentSummary(intent: ProductSearchIntent): string {
  const positive = [
    intent.category,
    intent.brand,
    intent.keywords.join("、"),
    intent.specTerms.join("、"),
    intent.minPrice !== undefined || intent.maxPrice !== undefined
      ? `${intent.minPrice ?? 0}-${intent.maxPrice ?? "不限"} ${"元"}`
      : undefined,
    intent.inStockOnly ? "有库存" : undefined,
  ].filter(Boolean);
  const exclude = [
    ...(intent.excludeTerms ?? []),
    ...(intent.excludeBrands ?? []),
    ...(intent.excludeCategories ?? []),
  ];
  const base = positive.length ? `已按“${positive.join("，")}”筛选` : "已按你的描述查找相关商品";
  return exclude.length ? `${base}，排除：${exclude.join("、")}` : base;
}
