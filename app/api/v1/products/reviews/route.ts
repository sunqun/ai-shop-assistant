import { NextResponse } from "next/server";
import { getCatalogProduct, listProductReviews } from "@/lib/catalog";
import { getProductReview } from "@/lib/catalog/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId")?.trim();
  if (!productId) {
    return NextResponse.json(
      { code: "PRODUCT_ID_REQUIRED", message: "缺少商品 ID。" },
      { status: 400 }
    );
  }
  // 评论分页由服务端限制上限，防止一次请求拉取无界数据。
  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(Number(url.searchParams.get("pageSize")) || 20))
  );
  const cursor = url.searchParams.get("cursor") || undefined;
  try {
    if (!(await getCatalogProduct(productId))) {
      return NextResponse.json(
        { code: "PRODUCT_NOT_FOUND", message: "商品不存在。" },
        { status: 404 }
      );
    }
    const reviewId = url.searchParams.get("reviewId");
    if (reviewId) {
      if (!/^\d{1,20}$/u.test(reviewId))
        return NextResponse.json(
          { code: "INVALID_REVIEW_ID", message: "评论编号无效。" },
          { status: 400 }
        );
      const review = await getProductReview(productId, reviewId);
      return review
        ? NextResponse.json({ review })
        : NextResponse.json(
            { code: "REVIEW_NOT_FOUND", message: "评论已不存在或不可读取。" },
            { status: 404 }
          );
    }
    const page = await listProductReviews(productId, pageSize, cursor);
    return NextResponse.json(page);
  } catch (error) {
    console.error(
      "list product reviews failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { code: "REVIEWS_UNAVAILABLE", message: "评论暂时无法加载，请稍后重试。" },
      { status: 503 }
    );
  }
}
