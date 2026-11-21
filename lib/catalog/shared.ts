import type { RowDataPacket } from "mysql2/promise";
import type { CatalogProduct } from "./types";

// 高毛利商品推荐分加权规则：毛利率达到阈值时，推荐分乘以放大系数。
// 阈值与系数集中在此定义，排序与分页游标共用同一表达式，避免多处重复。
export const HIGH_MARGIN_RANK_THRESHOLD = 0.3;
export const HIGH_MARGIN_RANK_FACTOR = 1.5;

// 生成「推荐分 × 毛利加权」的 SQL 排序表达式；alias 为商品表别名。
// 该分数只用于服务端排序，不通过任何结果字段暴露给前端或 LLM。
export function internalRankExpr(alias: string): string {
  return `${alias}.recommendation_score * CASE WHEN ${alias}.margin_rate >= ${HIGH_MARGIN_RANK_THRESHOLD} THEN ${HIGH_MARGIN_RANK_FACTOR} ELSE 1 END`;
}

export type ProductRow = RowDataPacket & {
  product_id: string;
  name: string;
  brand: string;
  category: string;
  category_id: string;
  tone: string;
  description: string;
  price: string | number;
  currency: string;
  stock: number;
  margin_rate: string | number;
  internal_rank: string | number;
  specs: string | Record<string, string> | null;
  rating: string | number | null;
  review_count: string | number;
};

export const PRODUCT_SELECT = `
  SELECT
    p.product_id, p.name, p.brand, c.name AS category, c.category_id, c.tone,
    p.description, p.price,
    p.currency, COALESCE(inv.on_hand - inv.reserved, 0) AS stock, p.margin_rate, p.specs,
    ROUND(AVG(r.rating), 1) AS rating,
    COUNT(r.review_id) AS review_count,
    (${internalRankExpr("p")}) AS internal_rank
  FROM products p
  LEFT JOIN categories c ON c.category_id = p.category_id
  LEFT JOIN inventory_skus inv ON inv.product_id = p.product_id
  LEFT JOIN product_reviews r ON r.product_id = p.product_id
`;

export const PRODUCT_GROUP = `
  GROUP BY p.product_id, p.name, p.brand, c.name, c.category_id, c.tone, p.description,
    p.price, p.currency, inv.on_hand, inv.reserved, p.margin_rate, p.recommendation_score, p.specs
`;

function parseSpecs(value: string | Record<string, string> | null): Record<string, string> {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  return value;
}

export function mapProduct(row: ProductRow): CatalogProduct {
  const rating = row.rating == null ? 0 : Number(row.rating);
  return {
    id: row.product_id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    categoryId: row.category_id,
    tone: row.tone,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    stock: Number(row.stock),
    rating: Math.round(rating * 10) / 10,
    reviewCount: Number(row.review_count ?? 0),
    specs: parseSpecs(row.specs),
  };
}

export function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&").slice(0, 80)}%`;
}
