"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { lineSubtotalMinor } from "@/lib/pricing-domain";

type PaymentLink = {
  linkId: string;
  token: string;
  username: string;
  product: { id: string; name: string; price: number; currency: string; stock: number };
  quantity: number;
  createdAt: string;
};
type Quote = {
  quote: {
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    totalDueMinor: number;
  };
};
type Order = { orderGroupId: string };

function formatMinor(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export default function HandoffPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [link, setLink] = useState<PaymentLink | null>(null);
  const [paymentPassword, setPaymentPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ quote: Quote; order: Order } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/handoff/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { link?: PaymentLink; message?: string };
        if (!response.ok) throw new Error(body.message || "支付短链不存在或已删除。");
        return body.link;
      })
      .then((nextLink) => {
        if (!cancelled) setLink(nextLink ?? null);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "支付短链暂时无法使用。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const subtotal = useMemo(
    () => (link ? lineSubtotalMinor(link.product.price, link.quantity) : 0),
    [link]
  );

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !paymentPassword.trim()) {
      setError("请输入支付密码。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/handoff/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          paymentPassword: paymentPassword.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = (await response.json()) as { quote?: Quote; order?: Order; message?: string };
      if (!response.ok) throw new Error(body.message || "下单失败，请稍后重试。");
      if (body.quote && body.order) setReceipt({ quote: body.quote, order: body.order });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "下单失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      eyebrow="长期交接入口"
      title="确认订单"
      description="无需登录，输入支付密码后即可下单。"
    >
      {loading ? (
        <div className="empty-state">
          <p>正在读取支付短链...</p>
        </div>
      ) : null}
      {!loading && error && !link ? (
        <div className="empty-state">
          <h2>支付短链不可用</h2>
          <p>{error}</p>
        </div>
      ) : null}
      {!loading && link && !receipt ? (
        <form className="handoff-card" onSubmit={submitOrder}>
          <div className="handoff-card__owner">由 {link.username} 创建</div>
          <div className="handoff-card__product">
            <div>
              <h2>{link.product.name}</h2>
              <p>
                数量：{link.quantity} · 单价：
                {link.product.currency === "TWD" ? "NT$" : link.product.currency}
                {link.product.price.toLocaleString()}
              </p>
            </div>
            <strong>
              {link.product.currency === "TWD"
                ? formatMinor(subtotal)
                : `${link.product.currency}${Math.round(subtotal / 100).toLocaleString()}`}
            </strong>
          </div>
          <label className="field" htmlFor="handoff-payment-password">
            <span>支付密码</span>
            <input
              id="handoff-payment-password"
              type="password"
              value={paymentPassword}
              onChange={(event) => setPaymentPassword(event.target.value)}
              autoComplete="off"
              required
              maxLength={128}
              placeholder="请输入支付密码"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            className="button button--primary handoff-card__submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "提交中..." : "确认下单"}
          </button>
        </form>
      ) : null}
      {receipt ? (
        <div className="handoff-card handoff-card--success">
          <h2>下单成功</h2>
          <p>订单编号：{receipt.order.orderGroupId}</p>
          <div className="cart-summary__line">
            <span>商品小计</span>
            <strong>{formatMinor(receipt.quote.quote.subtotalMinor)}</strong>
          </div>
          <div className="cart-summary__line">
            <span>优惠</span>
            <strong>{formatMinor(receipt.quote.quote.discountMinor)}</strong>
          </div>
          <div className="cart-summary__line">
            <span>运费</span>
            <strong>{formatMinor(receipt.quote.quote.shippingMinor)}</strong>
          </div>
          <div className="cart-summary__total">
            <span>订单金额</span>
            <strong>{formatMinor(receipt.quote.quote.totalDueMinor)}</strong>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
