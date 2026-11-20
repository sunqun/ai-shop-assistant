import type { ProductSearchIntent } from "@/lib/catalog";
import { parseProductSearchIntentWithMode } from "./index";

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

// 模型不可用时的降级意图：仅用正则从查询里抽出短商品短语，不猜品类/品牌/价格等字段。
export function fallbackIntent(query: string): ProductSearchIntent {
  return {
    keywords: extractFallbackTerms(query),
    specTerms: [],
    inStockOnly: false,
  };
}

// 简化的意图解析入口：只返回结构化意图，忽略解析模式。
export async function parseProductSearchIntent(query: string): Promise<ProductSearchIntent> {
  const { intent } = await parseProductSearchIntentWithMode(query);
  return intent;
}