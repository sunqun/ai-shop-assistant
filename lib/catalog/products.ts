import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db";
import type { CatalogProduct, ProductListFilter, ProductSearchIntent, ProductSearchPage } from "./types";
import { likeTerm, mapProduct, PRODUCT_GROUP, PRODUCT_SELECT, type ProductRow } from "./shared";

// 商品搜索别名表的一行：alias 为可检索别名，canonical_term 为标准化词。
type ProductSearchAliasRow = RowDataPacket & {
  alias: string;
  canonical_term: string;
};

async function expandSearchTermGroups(terms: string[]): Promise<string[][]> {
  const uniqueTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, 12);
  if (!uniqueTerms.length) return [];

  // 别名是运营可维护的数据；输入词既可以是别名，也可以是标准词，两个方向都展开。
  const placeholders = uniqueTerms.map(() => "?").join(", ");
  const [rows] = await getDbPool().query<ProductSearchAliasRow[]>(
    `SELECT alias, canonical_term
       FROM product_search_aliases
      WHERE is_active = TRUE
        AND (alias IN (${placeholders}) OR canonical_term IN (${placeholders}))`,
    [...uniqueTerms, ...uniqueTerms]
  );
  const variants = new Map(uniqueTerms.map((term) => [term, new Set([term])]));
  for (const row of rows) {
    for (const term of uniqueTerms) {
      if (row.alias === term || row.canonical_term === term) {
        variants.get(term)?.add(row.alias);
        variants.get(term)?.add(row.canonical_term);
      }
    }
  }
  return uniqueTerms.map((term) => [...(variants.get(term) ?? new Set([term]))]);
}

function buildExcludeClause(intent: ProductSearchIntent, params: Array<string | number>): string {
  // 否定匹配范围与正向关键词一致：名称/品牌/品类/描述/规格，命中任一即排除。
  const exclude = [
    ...(intent.excludeTerms ?? []),
    ...(intent.excludeBrands ?? []),
    ...(intent.excludeCategories ?? []),
  ];
  const clauses: string[] = [];
  for (const term of exclude) {
    const value = likeTerm(term);
    clauses.push(
      "(p.name LIKE ? OR p.brand LIKE ? OR c.name LIKE ? OR p.description LIKE ? OR CAST(p.specs AS CHAR) LIKE ?)"
    );
    params.push(value, value, value, value, value);
  }
  return clauses.length ? `NOT (${clauses.join(" OR ")})` : "";
}

function buildIntentWhere(intent: ProductSearchIntent, termGroups: string[][]): { sql: string; params: Array<string | number> } {
  // 所有条件都通过参数绑定传入，避免把模型返回的文本拼进 SQL。
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  for (const variants of termGroups) {
    const variantClauses: string[] = [];
    for (const term of variants) {
      variantClauses.push("(p.name LIKE ? OR p.brand LIKE ? OR c.name LIKE ? OR p.description LIKE ? OR CAST(p.specs AS CHAR) LIKE ?)");
      const value = likeTerm(term);
      params.push(value, value, value, value, value);
    }
    clauses.push(`(${variantClauses.join(" OR ")})`);
  }
  if (intent.brand) {
    clauses.push("p.brand LIKE ?");
    params.push(likeTerm(intent.brand));
  }
  if (intent.minPrice !== undefined) {
    clauses.push("p.price >= ?");
    params.push(intent.minPrice);
  }
  if (intent.maxPrice !== undefined) {
    clauses.push("p.price <= ?");
    params.push(intent.maxPrice);
  }
  if (intent.minRating !== undefined) {
    clauses.push("COALESCE((SELECT AVG(rating) FROM product_reviews rr WHERE rr.product_id = p.product_id), 0) >= ?");
    params.push(intent.minRating);
  }
  if (intent.inStockOnly) clauses.push("COALESCE(inv.on_hand - inv.reserved, 0) > 0");
  const excludeClause = buildExcludeClause(intent, params);
  if (excludeClause) clauses.push(excludeClause);
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

// 将商品 ID 编码为 base64url 游标，供分页时在服务端还原排序位置。
function encodeCursor(productId: string): string {
  return Buffer.from(JSON.stringify({ productId }), "utf8").toString("base64url");
}

// 解析游标；非法或缺失时返回 null，调用方按「从头检索」处理。
function decodeCursor(cursor: string | undefined): { productId: string } | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "productId" in parsed &&
      typeof parsed.productId === "string"
    ) {
      return parsed as { productId: string };
    }
  } catch {
    return null;
  }
  return null;
}

function tokenizeTerms(terms: string[]): string[] {
  // 把「咖啡 250g」这类带空格的短语拆成独立检索词，避免整体子串匹配失败。
  const out: string[] = [];
  for (const term of terms) {
    for (const token of term.trim().split(/\s+/u)) {
      if (token) out.push(token);
    }
  }
  return [...new Set(out)];
}

// 按结构化意图检索商品，返回分页结果；cursor 用于续取下一页，nextCursor 为 null 表示已到底。
export async function searchCatalogProducts(
  intent: ProductSearchIntent,
  pageSize: number,
  cursor?: string
): Promise<ProductSearchPage> {
  // category 降级并入检索词，避免把「咖啡」当成 categories.name 去精确过滤。
  const searchTerms = tokenizeTerms([
    ...intent.keywords,
    ...(intent.category ? [intent.category] : []),
    ...intent.specTerms,
  ]);
  const termGroups = await expandSearchTermGroups(searchTerms);
  const { sql, params } = buildIntentWhere(intent, termGroups);
  const decoded = decodeCursor(cursor);
  // 游标只保存商品 ID；排序分数始终在服务端计算，不能由客户端指定或读取。
  const havingSql = decoded
    ? "HAVING (internal_rank < (SELECT p2.recommendation_score * CASE WHEN p2.margin_rate >= 0.30 THEN 1.5 ELSE 1 END FROM products p2 WHERE p2.product_id = ?) OR (internal_rank = (SELECT p2.recommendation_score * CASE WHEN p2.margin_rate >= 0.30 THEN 1.5 ELSE 1 END FROM products p2 WHERE p2.product_id = ?) AND p.product_id > ?))"
    : "";
  if (decoded) params.push(decoded.productId, decoded.productId, decoded.productId);
  const [rows] = await getDbPool().query<ProductRow[]>(
    `${PRODUCT_SELECT} ${sql} ${PRODUCT_GROUP} ${havingSql} ORDER BY internal_rank DESC, p.product_id ASC LIMIT ?`,
    [...params, pageSize + 1]
  );
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const last = pageRows.at(-1);
  return {
    products: pageRows.map(mapProduct),
    nextCursor: hasMore && last ? encodeCursor(last.product_id) : null,
  };
}

// 返回前 100 件商品（空意图、不限条件），供目录页/默认列表使用。
export async function listCatalogProducts(): Promise<CatalogProduct[]> {
  const page = await searchCatalogProducts(
    { keywords: [], specTerms: [], inStockOnly: false },
    100
  );
  return page.products;
}

// 获取商品列表-搜索
export async function listProducts(filter: ProductListFilter = {}): Promise<CatalogProduct[]> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.categoryId) {
    clauses.push("p.category_id = ?");
    params.push(filter.categoryId);
  }
  if (filter.keyword && filter.keyword.trim()) {
    clauses.push("p.name LIKE ?");
    params.push(likeTerm(filter.keyword.trim()));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await getDbPool().query<ProductRow[]>(
    `${PRODUCT_SELECT} ${where} ${PRODUCT_GROUP} ORDER BY internal_rank DESC, p.product_id ASC LIMIT 100`,
    params
  );
  return rows.map(mapProduct);
}

// 按商品 ID 查询单个商品，不存在时返回 null。
export async function getCatalogProduct(productId: string): Promise<CatalogProduct | null> {
  const [rows] = await getDbPool().query<ProductRow[]>(
    `${PRODUCT_SELECT} WHERE p.product_id = ? ${PRODUCT_GROUP} LIMIT 1`,
    [productId]
  );
  return rows.length ? mapProduct(rows[0]) : null;
}

// 批量查询商品，返回 productId → 商品的 Map；去重后一次查询，避免循环打库。
export async function getCatalogProducts(productIds: string[]): Promise<Map<string, CatalogProduct>> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return new Map();
  const [rows] = await getDbPool().query<ProductRow[]>(
    `${PRODUCT_SELECT} WHERE p.product_id IN (?) ${PRODUCT_GROUP}`,
    [ids]
  );
  return new Map(rows.map((row) => [row.product_id, mapProduct(row)]));
}
