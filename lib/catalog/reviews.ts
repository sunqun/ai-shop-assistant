import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/repository/db";
import type { CatalogReview } from "./types";
import type { ReviewSnapshot } from "@/lib/reviews/types";

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

function mapReview(row: ReviewRow): CatalogReview {
  return {
    id: String(row.review_id),
    reviewer: redactReviewer(row.reviewer_name),
    rating: Number(row.rating),
    content: redactText(row.content),
    reviewedAt:
      row.reviewed_at instanceof Date
        ? row.reviewed_at.toISOString().slice(0, 10)
        : String(row.reviewed_at),
  };
}

export async function getProductReview(
  productId: string,
  reviewId: string
): Promise<CatalogReview | null> {
  if (!/^\d{1,20}$/u.test(reviewId)) return null;
  const [rows] = await getDbPool().query<ReviewRow[]>(
    "SELECT CAST(review_id AS CHAR) AS review_id, reviewer_name, rating, content, reviewed_at FROM product_reviews WHERE product_id = ? AND review_id = ? LIMIT 1",
    [productId, reviewId]
  );
  return rows[0] ? mapReview(rows[0]) : null;
}

type SnapshotCursor = ReviewSnapshot & { beforeId: string };
function encodeSnapshotCursor(snapshot: ReviewSnapshot, beforeId: string): string {
  return Buffer.from(JSON.stringify({ ...snapshot, beforeId }), "utf8").toString("base64url");
}
function decodeSnapshotCursor(productId: string, cursor: string): SnapshotCursor {
  if (cursor.length > 1500) throw new Error("Invalid review cursor");
  const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as SnapshotCursor;
  if (
    value.productId !== productId ||
    !/^\d{1,20}$/u.test(value.maxReviewId) ||
    !/^\d{1,20}$/u.test(value.beforeId) ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    !Number.isFinite(Date.parse(value.asOf)) ||
    BigInt(value.beforeId) > BigInt(value.maxReviewId) + BigInt(1)
  )
    throw new Error("Invalid review cursor");
  return value;
}
export type ReviewSnapshotPage = {
  reviews: CatalogReview[];
  cursorAfter: Record<string, string>;
  nextCursor: string | null;
  startCursor: string;
  snapshot: ReviewSnapshot;
  currentTotal: number;
};

// 分析专用 keyset 分页：固定起始编号上界，新增评论不会使跨页读取漂移。
export async function readProductReviewSnapshot(
  productId: string,
  pageSize: number,
  cursor?: string
): Promise<ReviewSnapshotPage> {
  const decoded = cursor ? decodeSnapshotCursor(productId, cursor) : undefined;
  const [counts] = await getDbPool().query<RowDataPacket[]>(
    {
      sql: `SELECT COUNT(*) AS total, CAST(COALESCE(MAX(review_id), 0) AS CHAR) AS max_id FROM product_reviews WHERE product_id = ?${decoded ? " AND review_id <= ?" : ""}`,
      timeout: 10000,
    },
    decoded ? [productId, decoded.maxReviewId] : [productId]
  );
  const currentTotal = Number(counts[0]?.total ?? 0);
  if (!Number.isSafeInteger(currentTotal)) throw new Error("Review count out of range");
  const snapshot: ReviewSnapshot = decoded
    ? { productId, maxReviewId: decoded.maxReviewId, total: decoded.total, asOf: decoded.asOf }
    : {
        productId,
        maxReviewId: String(counts[0]?.max_id ?? "0"),
        total: currentTotal,
        asOf: new Date().toISOString(),
      };
  const [rows] = await getDbPool().query<ReviewRow[]>(
    {
      sql: `SELECT CAST(review_id AS CHAR) AS review_id, reviewer_name, rating, content, reviewed_at FROM product_reviews WHERE product_id = ? AND review_id <= ?${decoded ? " AND review_id < ?" : ""} ORDER BY product_reviews.review_id DESC LIMIT ?`,
      timeout: 10000,
    },
    decoded
      ? [productId, snapshot.maxReviewId, decoded.beforeId, pageSize + 1]
      : [productId, snapshot.maxReviewId, pageSize + 1]
  );
  const visible = rows.slice(0, pageSize).map(mapReview);
  const cursorAfter = Object.fromEntries(
    visible.map((review) => [review.id, encodeSnapshotCursor(snapshot, review.id)])
  );
  return {
    reviews: visible,
    cursorAfter,
    snapshot,
    currentTotal,
    startCursor: encodeSnapshotCursor(snapshot, String(BigInt(snapshot.maxReviewId) + BigInt(1))),
    nextCursor:
      rows.length > pageSize && visible.length ? cursorAfter[visible[visible.length - 1].id] : null,
  };
}

export async function listProductReviews(
  productId: string,
  pageSize: number,
  cursor?: string
): Promise<{ reviews: CatalogReview[]; nextCursor: string | null }> {
  // 当前评论表没有独立发布/脱敏状态，已存在的评论记录作为公开源，返回前统一脱敏。
  const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  const [rows] = await getDbPool().query<ReviewRow[]>(
    `SELECT CAST(review_id AS CHAR) AS review_id, reviewer_name, rating, content, reviewed_at
       FROM product_reviews WHERE product_id = ? ORDER BY reviewed_at DESC, product_reviews.review_id DESC LIMIT ? OFFSET ?`,
    [productId, pageSize + 1, offset]
  );
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    reviews: pageRows.map(mapReview),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}
