"use client";

import { showToast } from "@/lib/toast";
import type { PaymentLinkView } from "@/lib/payment-link/payment-link-client";

function paymentLinkUrl(link: PaymentLinkView) {
  return `${window.location.origin}/handoff?token=${encodeURIComponent(link.urlToken)}`;
}

export function PaymentLinks({
  paymentLinks,
  deletingPaymentLinkId,
  onRemove,
}: {
  paymentLinks: PaymentLinkView[];
  deletingPaymentLinkId: string | null;
  onRemove: (link: PaymentLinkView) => void;
}) {
  async function copyPaymentLink(link: PaymentLinkView) {
    try {
      await navigator.clipboard.writeText(paymentLinkUrl(link));
      showToast("支付短链已复制。", "success");
    } catch {
      showToast("复制失败，请手动复制链接。", "info");
    }
  }

  return (
    <section className="assistant-payment-links assistant-payment-links--above" aria-label="支付短链">
      <div className="assistant-payment-links__header">
        <strong>支付短链</strong>
      </div>
      <div className="assistant-payment-links__list">
        {paymentLinks.map((link) => (
          <article className="assistant-payment-link" key={link.linkId}>
            <div className="assistant-payment-link__summary">
              <strong>{link.product.name}</strong>
              <span>数量 {link.quantity} · {link.username}</span>
            </div>
            <div className="assistant-payment-link__row">
              <div className="assistant-payment-link__url" title={paymentLinkUrl(link)}>
                {paymentLinkUrl(link)}
              </div>
              <div className="assistant-payment-link__actions">
                <button className="assistant-text-link" type="button" onClick={() => void copyPaymentLink(link)}>
                  复制
                </button>
                <button className="assistant-text-link" type="button" onClick={() => window.open(paymentLinkUrl(link), "_blank", "noopener,noreferrer")}>
                  打开
                </button>
                <button className="assistant-text-link assistant-text-link--danger" type="button" disabled={deletingPaymentLinkId === link.linkId} onClick={() => onRemove(link)}>
                  {deletingPaymentLinkId === link.linkId ? "删除中..." : "删除"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
