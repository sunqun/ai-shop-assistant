import { NextResponse } from "next/server";
import { listCatalogProducts } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await listCatalogProducts();
    return NextResponse.json({ products });
  } catch (error) {
    console.error("list products failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { code: "PRODUCTS_UNAVAILABLE", message: "商品暂时无法加载，请稍后重试。" },
      { status: 503 }
    );
  }
}
