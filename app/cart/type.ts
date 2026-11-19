import type { CatalogProduct } from "@/lib/catalog";
import type { CartQuote, UserCartItem } from "@/lib/cart-client/cart-client";

export type { CatalogProduct, CartQuote, UserCartItem };

/** 商品目录接口返回结构 */
export type ProductsResponse = {
  products: CatalogProduct[];
};

/** 商品与购物车条目合并后的一行数据 */
export type CartLine = {
  item: UserCartItem;
  product: CatalogProduct;
};
