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
  quantity?: number;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStockOnly: boolean;
  // 服务端根据当前焦点商品设置，不接受模型任意指定交易对象。
  productIds?: string[];
  // 通用自然语言条件，由目录内容校验；偏好不作为硬过滤条件。
  requiredConditions?: string[];
  preferences?: string[];
  numericConstraints?: NumericSpecConstraint[];
  // 服务端发现无法核实的解析结果；只能澄清，不能作为已验证条件下单。
  unresolvedConditions?: string[];
  // 否定与纠错：出现在名称/品牌/品类/描述/规格中即排除。
  excludeTerms?: string[];
  excludeBrands?: string[];
  excludeCategories?: string[];
};

export type NumericSpecConstraint = {
  attribute: string;
  operator: "gte" | "lte" | "eq";
  value: number;
  unit?: string;
  // 新模型条件携带用户本轮原话的连续片段，用于核实数值依据，不参与目录匹配。
  evidence?: string;
};

export type ProductSearchPage = {
  products: CatalogProduct[];
  nextCursor: string | null;
  clarification?: string;
  clarificationContext?: import("@/lib/intent/type").ClarificationContext;
};

export type CatalogCategory = {
  id: string;
  name: string;
  count: number;
};

export type ProductListFilter = {
  categoryId?: string;
  keyword?: string;
  sort?: "recommended" | "price-low" | "price-high" | "rating";
};
