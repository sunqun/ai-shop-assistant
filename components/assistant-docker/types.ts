export type AgentProduct = {
  id: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  price: number;
  currency: string;
  stock: number;
  rating: number;
  reviewCount: number;
  specs: Record<string, string>;
};

export type AgentReview = {
  id: string;
  reviewer: string;
  rating: number;
  content: string;
  reviewedAt: string;
};

export type SearchResponse = {
  products?: AgentProduct[];
  nextCursor?: string | null;
  intentSummary?: string;
};

export type DetailResponse = {
  product: AgentProduct;
  reviews: AgentReview[];
};

export type OrderReceipt = {
  orderGroupId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  totalMinor: number;
};
