import { readApiResponse, runWithLoginRetry } from "@/lib/auth-retry";

export type PaymentLinkView = {
  linkId: string;
  token: string;
  urlToken: string;
  username: string;
  product: { id: string; name: string; price: number; currency: string; stock: number };
  quantity: number;
  createdAt: string;
};

export async function listPaymentLinks(): Promise<PaymentLinkView[]> {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/assistant/payment-links", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await readApiResponse<{ links?: PaymentLinkView[] }>(response, "支付短链暂时无法读取。");
    return Array.isArray(payload.links) ? payload.links : [];
  });
}

export async function createPaymentLink(productId: string, quantity: number): Promise<PaymentLinkView> {
  return runWithLoginRetry(async () => {
    const response = await fetch("/api/v1/assistant/payment-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ productId, quantity }),
    });
    const payload = await readApiResponse<{ link: PaymentLinkView }>(response, "支付短链生成失败。");
    return payload.link;
  });
}

export async function deletePaymentLink(linkId: string): Promise<void> {
  return runWithLoginRetry(async () => {
    const response = await fetch(`/api/v1/assistant/payment-links/${encodeURIComponent(linkId)}`, {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
    });
    await readApiResponse<Record<string, never>>(response, "支付短链删除失败。");
  });
}
