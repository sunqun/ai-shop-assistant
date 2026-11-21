import { NextResponse } from "next/server";
import { getCatalogProducts, listProductPage, ProductPageError } from "@/lib/catalog";
import type { ProductListFilter } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("categoryId") ?? undefined;
  const keyword = searchParams.get("keyword") ?? undefined;
  const sort = searchParams.get("sort") ?? "recommended";
  const pageSize = Number(searchParams.get("pageSize") ?? 20);
  const cursor = searchParams.get("cursor") ?? undefined;
  if (!["recommended", "price-low", "price-high", "rating"].includes(sort) ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || (cursor?.length ?? 0) > 2000 ||
      (keyword?.length ?? 0) > 200 || (categoryId?.length ?? 0) > 100)
    return NextResponse.json({ code: "INVALID_PRODUCT_QUERY", message: "商品分页参数无效。" }, { status: 400 });
  try {
    const ids = searchParams.get("ids");
    if (ids !== null) {
      const productIds = [...new Set(ids.split(","))];
      if (!productIds.length || productIds.length > 100 || productIds.some((id) => !/^[A-Za-z0-9._-]{1,100}$/u.test(id)))
        return NextResponse.json({ code: "INVALID_PRODUCT_IDS", message: "商品编号无效。" }, { status: 400 });
      return NextResponse.json({ products: [...(await getCatalogProducts(productIds)).values()], nextCursor: null });
    }
    return NextResponse.json(await listProductPage({ categoryId, keyword, sort: sort as ProductListFilter["sort"] }, pageSize, cursor));
  } catch (error) {
    if (error instanceof ProductPageError)
      return NextResponse.json({ code: error.message, message: "商品分页已失效，请重新加载。" }, { status: 400 });
    console.error("list products failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { code: "PRODUCTS_UNAVAILABLE", message: "商品暂时无法加载，请稍后重试。" },
      { status: 503 }
    );
  }
}
