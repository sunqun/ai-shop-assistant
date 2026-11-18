"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { useAuth } from "@/components/auth-provider";
import { getProduct } from "@/lib/products";
import { lineSubtotalMinor } from "@/lib/pricing-domain";
import {
  fetchCart,
  quoteCart,
  submitOrder,
  type CartQuote,
  type UserCartItem,
} from "@/lib/cart-client";
import { showToast } from "@/lib/toast";

type CheckoutState = "loading" | "ready" | "error";

function money(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { user, loading: authLoading, openLogin } = useAuth();
  const [state, setState] = useState<CheckoutState>("loading");
  const [items, setItems] = useState<UserCartItem[]>([]);
  const [cartVersion, setCartVersion] = useState<number | null>(null);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const rows = useMemo(
    () =>
      items
        .map((item) => ({ item, product: getProduct(item.productId) }))
        .filter((row) => row.product),
    [items]
  );

  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setCartVersion(null);
      setQuote(null);
      setState("loading");
      return;
    }
    let active = true;
    (async () => {
      try {
        setState("loading");
        const cart = await fetchCart();
        if (!active) return;
        if (!cart.items.length) {
          setState("error");
          showToast("购物车为空，请先选择商品。", "info");
          return;
        }
        setItems(cart.items);
        setCartVersion(cart.cartVersion);
        const result = await quoteCart(cart.cartVersion);
        if (!active) return;
        setQuote(result.quote);
        setState("ready");
      } catch {
        if (active) {
          setState("error");
          showToast("无法确认购物车和报价，请稍后重试。");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  async function createOrder() {
    if (!quote || cartVersion === null || submitting) return;
    setSubmitting(true);
    try {
      await submitOrder(cartVersion, quote.quoteId, idempotencyKey);
      router.push("/account/orders");
    } catch {
      showToast("订单创建失败，请稍后重试。");
      setIdempotencyKey((current) => current || crypto.randomUUID());
    } finally {
      setSubmitting(false);
    }
  }

  if (!authLoading && !user)
    return (
      <PageShell eyebrow="确认订单" title="请先登录">
        <div className="empty-state">
          <h2>请先登录</h2>
          <p>确认订单前需要登录账号。</p>
          <button className="button button--primary" type="button" onClick={openLogin}>
            登录
          </button>
        </div>
      </PageShell>
    );

  if (!rows.length && state === "error")
    return (
      <PageShell eyebrow="确认订单" title="确认订单">
        <PlaceholderCard
          title="无法继续结账"
          description="购物车为空或商品信息暂时不可用，请返回购物车检查后重试。"
          actionHref="/cart"
          actionLabel="返回购物车"
        />
      </PageShell>
    );

  return (
    <PageShell
      eyebrow="确认订单"
      title="确认订单"
      description="确认商品和报价后付款并创建订单，提交成功后会扣减已锁定库存。"
    >
      <div className="layout-two-column">
        <section className="card stack" aria-label="订单商品">
          <h2>商品清单</h2>
          {rows.map(({ item, product }) => (
            <div className="list-item" key={item.skuId}>
              <div>
                <p className="list-item__title">{product!.name}</p>
                <p className="list-item__meta">
                  规格：{item.skuId} · 数量：{item.requestedQuantity}
                </p>
              </div>
              <strong>{money(lineSubtotalMinor(product!.price, item.allocatedQuantity || item.requestedQuantity))}</strong>
            </div>
          ))}
          <p className="notice">提交后会创建订单并扣减本次已锁定的库存；真实支付尚未接入。</p>
        </section>
        <aside className="card stack" aria-label="报价与创建订单">
          <h2>费用摘要</h2>
          {state === "loading" ? (
            <p role="status" className="muted">
              正在确认库存和报价…
            </p>
          ) : null}
          {state === "ready" && quote ? (
            <>
              <div className="cart-summary__line">
                <span>商品小计</span>
                <strong>{money(quote.subtotalMinor)}</strong>
              </div>
              <div className="cart-summary__line">
                <span>优惠</span>
                <strong>{money(quote.discountMinor)}</strong>
              </div>
              <div className="cart-summary__line">
                <span>运费</span>
                <strong>{money(quote.shippingMinor)}</strong>
              </div>
              <div className="cart-summary__total">
                <span>订单金额</span>
                <strong>{money(quote.totalDueMinor)}</strong>
              </div>
              <p className="muted">报价有效至 {new Date(quote.expiresAt).toLocaleString()}</p>
            </>
          ) : null}
          {state === "error" ? (
            <p role="alert" className="notice notice--error">
              库存和报价暂时无法确认，请稍后重试或返回购物车。
            </p>
          ) : null}
          {user && !user.isAuthorized ? (
            <p role="alert" className="notice notice--error">
              当前账户尚未完成下单授权。请前往“我的”管理授权。
            </p>
          ) : null}
          <button
            className="button button--primary"
            type="button"
            disabled={state !== "ready" || !user?.isAuthorized || submitting}
            onClick={createOrder}
          >
            {submitting ? "正在创建订单并扣减库存…" : "付款"}
          </button>
          <button className="button button--ghost" type="button" onClick={() => router.push("/cart")}>
            返回购物车
          </button>
        </aside>
      </div>
    </PageShell>
  );
}
