import { z } from "zod";
import { createLLMFromEnv } from "@/lib/llm";
import type { Message, Tool } from "@/lib/llm/type";
import type { ProductSearchIntent } from "@/lib/catalog";
import { fallbackIntent } from "./fallback-indent";

// 意图解析层的全局上限：查询文本长度与单个意图字段的词数上限。
const MAX_QUERY_LENGTH = 1000;
const MAX_TERMS = 12;

// 将任意输入收敛为 [min, max] 区间内的有限数值；非数值或非法值返回 undefined。
function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

// 从模型输出中安全提取字符串数组：只保留字符串项，逐项裁剪长度并限制数量。
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, MAX_TERMS);
}

// 模型输出只作为候选条件，先做类型、长度和数值范围校验，再交给数据库查询。
function normalizeIntent(value: unknown): ProductSearchIntent {
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

// 生成意图解析的 system prompt：约束模型只做理解与结构化，不回答、不推荐、不访问数据。
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

// 意图参数 schema：字段全部可选且带 catch 兜底，模型输出字段缺失或类型错误都不拦截，
// 统一交给 normalizeIntent 做领域归一化；字段类型用于生成 function calling 的工具声明。
const intentArgsSchema = z
  .object({
    keywords: z.array(z.string()).catch([]),
    category: z.string().nullable().catch(null),
    brand: z.string().nullable().catch(null),
    minPrice: z.number().nullable().catch(null),
    maxPrice: z.number().nullable().catch(null),
    minRating: z.number().nullable().catch(null),
    inStockOnly: z.boolean().catch(false),
    specTerms: z.array(z.string()).catch([]),
    excludeTerms: z.array(z.string()).catch([]),
    excludeBrands: z.array(z.string()).catch([]),
    excludeCategories: z.array(z.string()).catch([]),
  })
  .partial()
  .passthrough();

// 供 LLM function calling 使用的工具：把意图解析强制收敛成结构化筛选条件。
const intentTool: Tool = {
  description:
    "解析用户商品搜索意图，输出结构化筛选条件；不回答用户问题、不推荐商品、不访问数据库。",
  inputSchema: intentArgsSchema,
  execute: async (args) => normalizeIntent(args),
};

// 搜索模式：model 表示由 LLM 解析，fallback 表示模型失败后由正则降级解析。
export type ProductSearchMode = "model" | "fallback";

// 参与意图解析的历史轮次：只携带查询文本与意图摘要，不携带完整结构化意图。
export type IntentHistoryTurn = { query: string; intentSummary: string };

// 带模式的意图解析入口：优先走 LLM function calling，失败时用正则降级，并返回实际采用的解析模式。
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

  const llm = createLLMFromEnv();

  // LLM 只负责把自然语言转换成结构化条件，不接触商品数据和内部推荐字段。
  const messages: Message[] = [
    { role: "system", content: buildIntentSystemPrompt() },
    ...history.flatMap<Message>((turn) => [
      { role: "user", content: turn.query },
      { role: "assistant", content: turn.intentSummary },
    ]),
    { role: "user", content: normalizedQuery },
  ];

  try {
    const result = await llm.invoke(
      messages,
      { parse_product_search_intent: intentTool },
      AbortSignal.timeout(12_000),
      { toolChoiceName: "parse_product_search_intent", temperature: 0 }
    );
    return { intent: result.toolResult as ProductSearchIntent, searchMode: "model" };
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

// 判断意图是否为空（无任何商品/品类/品牌/价格/评分/库存/排除条件），用于短路闲聊或超域查询。
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

// 合并上一轮意图与本轮意图：本轮没有新增检索主体时继承上一轮的 keywords/category/brand，并合并其余条件。
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

// 把结构化意图压缩成一句人类可读的摘要，用于展示与作为下一轮 LLM 的历史上下文。
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
