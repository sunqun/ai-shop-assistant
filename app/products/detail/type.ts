import type { CatalogProduct, CatalogReview } from "@/lib/catalog";

export type { CatalogProduct, CatalogReview };

/** 商品详情接口返回结构 */
export type DetailResponse = {
  product: CatalogProduct;
  reviews: CatalogReview[];
};
