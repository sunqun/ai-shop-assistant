export type AssistantResult = {
  status?: "ready_for_confirmation" | "ordered" | "needs_login" | "needs_authorization" | "failed";
  message?: string;
  product?: { id?: string; name?: string; price?: number; stock?: number };
  quote?: {
    quote?: {
      quoteId: string;
      cartVersion: number;
      currency: string;
      totalDueMinor: number;
      expiresAt: string;
    };
  };
  order?: { orderGroupId?: string; orders?: Array<{ orderId: string }> };
};

export type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  result?: AssistantResult;
  shortLink?: string;
};

export type Confirmation = { cartVersion: number; quoteId: string };

export type PaymentLinkResponse = {
  link?: { urlToken?: string };
  message?: string;
};
