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

export type CatalogReview = {
  id: string;
  reviewer: string;
  rating: number;
  content: string;
  reviewedAt: string;
};

export type ProductSearchIntent = {
  keywords: string[];
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStockOnly: boolean;
  specTerms: string[];
};

export type ProductSearchPage = {
  products: CatalogProduct[];
  nextCursor: string | null;
};

export type CatalogCategory = {
  id: string;
  name: string;
  count: number;
};

export type ProductListFilter = {
  categoryId?: string;
  keyword?: string;
};
