import { NextResponse } from "next/server";
import { getCatalogProduct } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  try {
    const product = await getCatalogProduct(productId);
    if (!product) {
      return NextResponse.json({ code: "PRODUCT_NOT_FOUND", message: "商品不存在。" }, { status: 404 });
    }
    return NextResponse.json({ product });
  } catch (error) {
    console.error("get product failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { code: "PRODUCT_UNAVAILABLE", message: "商品暂时无法加载，请稍后重试。" },
      { status: 503 }
    );
  }
}
