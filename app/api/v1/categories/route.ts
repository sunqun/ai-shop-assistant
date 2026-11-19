import { NextResponse } from "next/server";
import { listCategories } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const categories = await listCategories();
    return NextResponse.json({ categories });
  } catch (error) {
    console.error("list categories failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { code: "CATEGORIES_UNAVAILABLE", message: "分类暂时无法加载，请稍后重试。" },
      { status: 503 }
    );
  }
}
