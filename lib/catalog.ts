import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db";

export type CatalogProduct = {
  id: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  price: number;
  currency: string;
  stock: number;
  rating: number;
  reviewCount: number;
  specs: Record<string, string>;
};

export type CatalogReview = {
  id: string;
  reviewer: string;
  rating: number;
  content: string;
  reviewedAt: string;
};

export type ProductSearchIntent = {
  keywords: string[];
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStockOnly: boolean;
  specTerms: string[];
};

type ProductRow = RowDataPacket & {
  product_id: string;
  name: string;
  brand: string;
  category: string;
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

type ReviewRow = RowDataPacket & {
  review_id: string | number;
  reviewer_name: string;
  rating: string | number;
  content: string;
  reviewed_at: string | Date;
};

const PRODUCT_SELECT = `
  SELECT
    p.product_id, p.name, p.brand, p.category, p.description, p.price,
    p.currency, p.stock, p.margin_rate, p.specs,
    ROUND(AVG(r.rating), 1) AS rating,
    COUNT(r.review_id) AS review_count,
    (p.recommendation_score * CASE WHEN p.margin_rate >= 0.30 THEN 1.5 ELSE 1 END) AS internal_rank
  FROM products p
  LEFT JOIN product_reviews r ON r.product_id = p.product_id
`;

const PRODUCT_GROUP = `
  GROUP BY p.product_id, p.name, p.brand, p.category, p.description,
    p.price, p.currency, p.stock, p.margin_rate, p.recommendation_score, p.specs
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

function mapProduct(row: ProductRow): CatalogProduct {
  const rating = row.rating == null ? 0 : Number(row.rating);
  return {
    id: row.product_id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    stock: Number(row.stock),
    rating: Math.round(rating * 10) / 10,
    reviewCount: Number(row.review_count ?? 0),
    specs: parseSpecs(row.specs),
  };
}

function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&").slice(0, 80)}%`;
}

function buildIntentWhere(intent: ProductSearchIntent): { sql: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const terms = [...intent.keywords, ...intent.specTerms].filter(Boolean).slice(0, 12);
  for (const term of terms) {
    clauses.push("(p.name LIKE ? OR p.brand LIKE ? OR p.category LIKE ? OR p.description LIKE ? OR CAST(p.specs AS CHAR) LIKE ?)");
    const value = likeTerm(term);
    params.push(value, value, value, value, value);
  }
  if (intent.category) {
    clauses.push("p.category LIKE ?");
    params.push(likeTerm(intent.category));
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
  if (intent.inStockOnly) clauses.push("p.stock > 0");
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function encodeCursor(productId: string): string {
  return Buffer.from(JSON.stringify({ productId }), "utf8").toString("base64url");
}

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

export type ProductSearchPage = {
  products: CatalogProduct[];
  nextCursor: string | null;
};

export async function searchCatalogProducts(
  intent: ProductSearchIntent,
  pageSize: number,
  cursor?: string
): Promise<ProductSearchPage> {
  const { sql, params } = buildIntentWhere(intent);
  const decoded = decodeCursor(cursor);
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

export async function listCatalogProducts(): Promise<CatalogProduct[]> {
  const page = await searchCatalogProducts(
    { keywords: [], specTerms: [], inStockOnly: false },
    100
  );
  return page.products;
}

export async function getCatalogProduct(productId: string): Promise<CatalogProduct | null> {
  const [rows] = await getDbPool().query<ProductRow[]>(
    `${PRODUCT_SELECT} WHERE p.product_id = ? ${PRODUCT_GROUP} LIMIT 1`,
    [productId]
  );
  return rows.length ? mapProduct(rows[0]) : null;
}

function redactText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[已隐藏联系方式]")
    .replace(/(?:\+?\d[\d\s-]{7,}\d)/g, "[已隐藏联系方式]")
    .replace(/(?:地址|住址)[:：]?[^，。；;\n]{4,}/g, "[已隐藏地址]");
}

function redactReviewer(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "匿名用户";
  return `${trimmed.slice(0, 1)}${trimmed.length > 1 ? "**" : ""}`;
}

export async function listProductReviews(
  productId: string,
  pageSize: number,
  cursor?: string
): Promise<{ reviews: CatalogReview[]; nextCursor: string | null }> {
  const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  const [rows] = await getDbPool().query<ReviewRow[]>(
    `SELECT review_id, reviewer_name, rating, content, reviewed_at
       FROM product_reviews WHERE product_id = ? ORDER BY reviewed_at DESC, review_id DESC LIMIT ? OFFSET ?`,
    [productId, pageSize + 1, offset]
  );
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    reviews: pageRows.map((row) => ({
      id: String(row.review_id),
      reviewer: redactReviewer(row.reviewer_name),
      rating: Number(row.rating),
      content: redactText(row.content),
      reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString().slice(0, 10) : String(row.reviewed_at),
    })),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}
