import type { CatalogProduct } from "@/lib/catalog";
import type { ReviewAnalysisReport } from "@/lib/reviews/types";

export type AssistantResult = {
  status?:
    | "ready_for_confirmation"
    | "ordered"
    | "needs_login"
    | "needs_authorization"
    | "needs_clarification"
    | "failed";
  message?: string;
  product?: Partial<CatalogProduct>;
  quantity?: number;
  quote?: {
    quote?: {
      quoteId: string;
      cartVersion: number;
      currency: string;
      totalDueMinor: number;
      subtotalMinor?: number;
      discountMinor?: number;
      shippingMinor?: number;
      expiresAt: string;
    };
  };
  order?: { orderGroupId?: string; orders?: Array<{ orderId: string }> };
};

export type ChatMessage = {
  taskId?: string;
  role: "assistant" | "user";
  text: string;
  result?: AssistantResult;
  shortLink?: string;
  reviewAnalysis?: ReviewAnalysisReport;
};

export type Confirmation = { cartVersion: number; quoteId: string };

export type PaymentLinkResponse = {
  link?: { urlToken?: string };
  message?: string;
};
