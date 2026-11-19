import { NextResponse } from "next/server";
import { listProducts } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("categoryId") ?? undefined;
  const keyword = searchParams.get("keyword") ?? undefined;
  try {
    const products = await listProducts({ categoryId, keyword });
    return NextResponse.json({ products });
  } catch (error) {
    console.error("list products failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { code: "PRODUCTS_UNAVAILABLE", message: "商品暂时无法加载，请稍后重试。" },
      { status: 503 }
    );
  }
}
