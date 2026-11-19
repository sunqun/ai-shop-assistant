import type { RowDataPacket } from "mysql2/promise";
import type { CatalogProduct } from "./types";

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
    (p.recommendation_score * CASE WHEN p.margin_rate >= 0.30 THEN 1.5 ELSE 1 END) AS internal_rank
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
