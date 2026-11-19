"use client";

import { use, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { lineSubtotalMinor } from "@/lib/pricing-domain";
import { showToast } from "@/lib/toast";
import { getPaymentLinkRequest, submitPaymentLinkOrderRequest } from "./api";
import type { Order, PaymentLink, Quote } from "./type";

function formatMinor(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export default function HandoffPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = use(searchParams);
  const tokenValue = token ?? "";
  const [link, setLink] = useState<PaymentLink | null>(null);
  const [paymentPassword, setPaymentPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{ quote: Quote; order: Order } | null>(null);

  useEffect(() => {
    if (!tokenValue) {
      setLoading(false);
      showToast("支付短链不存在或已删除。");
      return;
    }
    let cancelled = false;
    setLoading(true);
    getPaymentLinkRequest(tokenValue)
      .then((result) => {
        if (cancelled) return;
        if (result.success) setLink(result.data.link ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenValue]);

  const subtotal = useMemo(
    () => (link ? lineSubtotalMinor(link.product.price, link.quantity) : 0),
    [link]
  );

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tokenValue || !paymentPassword.trim()) {
      showToast("请输入支付密码。");
      return;
    }
    setSubmitting(true);
    const result = await submitPaymentLinkOrderRequest({
      token: tokenValue,
      paymentPassword: paymentPassword.trim(),
      idempotencyKey: crypto.randomUUID(),
    });
    setSubmitting(false);
    if (result.success && result.data.quote && result.data.order) {
      setReceipt({ quote: result.data.quote, order: result.data.order });
    }
  }

  return (
    <PageShell
      title="确认订单"
      description="无需登录，输入支付密码后即可下单。"
    >
      {loading ? (
        <div className="empty-state">
          <p>正在读取支付短链...</p>
        </div>
      ) : null}
      {!loading && !link && !receipt ? (
        <div className="empty-state">
          <h2>支付短链不可用</h2>
          <p>请通过有效短链访问。</p>
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
          {link ? (
            <div className="handoff-card__product">
              <div>
                <h2>{link.product.name}</h2>
                <p>
                  商品编号：{link.product.id} · 数量：{link.quantity} · 单价：
                  {link.product.currency === "TWD" ? "NT$" : link.product.currency}
                  {link.product.price.toLocaleString()}
                </p>
              </div>
            </div>
          ) : null}
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
