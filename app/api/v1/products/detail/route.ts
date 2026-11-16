import { NextResponse } from "next/server";
import { getCatalogProduct, listProductReviews } from "@/lib/catalog";

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

  // 评论列表由服务端限制上限，防止一次请求拉取无界数据。
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));

  try {
    const product = await getCatalogProduct(productId);
    if (!product) {
      return NextResponse.json({ code: "PRODUCT_NOT_FOUND", message: "商品不存在。" }, { status: 404 });
    }
    const page = await listProductReviews(productId, pageSize);
    return NextResponse.json({ product, reviews: page.reviews, nextCursor: page.nextCursor });
  } catch (error) {
    console.error("get product detail failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { code: "PRODUCT_UNAVAILABLE", message: "商品暂时无法加载，请稍后重试。" },
      { status: 503 }
    );
  }
}
