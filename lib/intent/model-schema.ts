import { z } from "zod";
import type { ProductSearchIntent } from "@/lib/catalog";
import type { Tool } from "@/lib/llm/type";
import { normalizeWhitespace } from "@/lib/common/text";
import { EDITABLE_INTENT_FIELDS, MAX_TERMS } from "./type";
import type { IntentToolOutput } from "./type";

// 类型、长度和数量已由 schema 校验；这里只整理空白，不截断或丢弃用户条件。
function stringList(value: string[] | undefined): string[] {
  return (value ?? []).map(normalizeWhitespace);
}

// 模型输出只作为候选条件，先做类型、长度和数值范围校验，再交给数据库查询。
function normalizeIntent(source: z.infer<typeof intentArgsSchema>): ProductSearchIntent {
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
  const category = source.category ? normalizeWhitespace(source.category) : undefined;
  return {
    keywords,
    quantity: source.quantity ?? undefined,
    // 同一词被模型重复标成品类和商品词时，只保留商品词；否则数据库会再要求分类名也匹配该词。
    category:
      category &&
      keywords.some((keyword) => keyword.toLocaleLowerCase() === category.toLocaleLowerCase())
        ? undefined
        : category,
    brand: source.brand ? normalizeWhitespace(source.brand) : undefined,
    minPrice: source.minPrice ?? undefined,
    maxPrice: source.maxPrice ?? undefined,
    minRating: source.minRating ?? undefined,
    inStockOnly: source.inStockOnly === true,
    requiredConditions: stringList(source.requiredConditions),
    preferences: stringList(source.preferences),
    numericConstraints: (source.numericConstraints ?? []).map((item) => ({
      ...item,
      attribute: normalizeWhitespace(item.attribute),
      evidence: item.evidence ?? undefined,
    })),
    excludeTerms,
    excludeBrands,
    excludeCategories,
  };
}

const termSchema = z.string().trim().min(1).max(80);
const termsSchema = z.array(termSchema).max(MAX_TERMS);

// 动作和置信度必填。未提及的条件可缺省，但已返回的非法条件必须让整次解析失败，
// 由模型调用层重试或路由层澄清，不能静默扩大搜索范围。
const intentArgsSchema = z
  .object({
    action: z
      .enum([
        "new_search",
        "refine_search",
        "confirm_order",
        "cancel_task",
        "query_status",
        "analyze_reviews",
        "chat",
        "clarify",
      ]),
    confidence: z.number().min(0).max(1),
    reply: z.string().max(1000).optional(),
    reviewMode: z.enum(["reuse", "continue", "refresh"]).nullish(),
    keywords: termsSchema.optional(),
    category: termSchema.nullish(),
    brand: termSchema.nullish(),
    minPrice: z.number().min(0).max(10_000_000).nullish(),
    maxPrice: z.number().min(0).max(10_000_000).nullish(),
    minRating: z.number().min(0).max(5).nullish(),
    inStockOnly: z.boolean().optional(),
    quantity: z.number().int().min(1).max(99).nullish(),
    edits: z.array(z.object({
      field: z.enum(EDITABLE_INTENT_FIELDS),
      operation: z.enum(["clear", "remove"]),
      values: z.array(z.string().max(1000)).max(12).optional(),
      evidence: z.string().min(1).max(1000),
    }).strict()).max(24).optional(),
    requiredConditions: termsSchema.optional(),
    preferences: termsSchema.optional(),
    numericConstraints: z
      .array(
        z.object({
          attribute: termSchema,
          operator: z.enum(["gte", "lte", "eq"]),
          value: z.number().nonnegative(),
          unit: z.string().trim().max(20).optional(),
          evidence: z.string().max(1000).nullish(),
        })
      )
      .max(MAX_TERMS)
      .optional(),
    excludeTerms: termsSchema.optional(),
    excludeBrands: termsSchema.optional(),
    excludeCategories: termsSchema.optional(),
  });

// 供 LLM function calling 使用的工具：把意图解析强制收敛成结构化筛选条件。
export const intentTool: Tool = {
  description:
    "一次判断用户本轮动作，并在搜索时输出本轮结构化条件；非搜索动作可省略搜索字段，不推荐商品、不访问数据库、不执行操作。",
  inputSchema: intentArgsSchema,
  execute: async (args): Promise<IntentToolOutput> => {
    const parsed = intentArgsSchema.parse(args);
    return {
      intent: normalizeIntent(parsed),
      edits: parsed.edits,
      decision: {
        action: parsed.action,
        confidence: parsed.confidence,
        reply: parsed.reply,
        reviewMode:
          parsed.action === "analyze_reviews" ? (parsed.reviewMode ?? undefined) : undefined,
      },
    };
  },
};
