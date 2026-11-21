export type CatalogProduct = {
  id: string;
  name: string;
  brand: string;
  category: string;
  categoryId: string;
  tone: string;
  description: string;
  price: number;
  currency: string;
  stock: number;
  rating: number;
  reviewCount: number;
  specs: Record<string, string>;
};

export type CatalogCategory = {
  id: string;
  name: string;
  count: number;
};

export type ProductsResponse = {
  products: CatalogProduct[];
  nextCursor: string | null;
};

export type CategoriesResponse = {
  categories: CatalogCategory[];
};

export type GetProductsParams = {
  categoryId?: string;
  keyword?: string;
  sort?: "recommended" | "price-low" | "price-high" | "rating";
  pageSize?: number;
  cursor?: string;
};

export type PromotionRule = {
  id: string;
  label: string;
};
