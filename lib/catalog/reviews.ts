import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db";
import type { CatalogReview } from "./types";

type ReviewRow = RowDataPacket & {
  review_id: string | number;
  reviewer_name: string;
  rating: string | number;
  content: string;
  reviewed_at: string | Date;
};

function redactText(value: string): string {
  // 评论接口只返回公开视图，先清理常见联系方式和地址片段。
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
  // 当前评论表没有独立发布/脱敏状态，已存在的评论记录作为公开源，返回前统一脱敏。
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
