"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { reconcileAiCart, quoteAiCart, submitAiOrder } from "@/lib/ai-cart-client";
import { addToCartAndPersist } from "@/lib/cart-client";
import { useOptionalAuth } from "@/components/auth-provider";
import {
  createPaymentLink,
  deletePaymentLink,
  listPaymentLinks,
  type PaymentLinkView,
} from "@/lib/payment-link-client";
import { showToast } from "@/lib/toast";
import { ArrowRight, Bot, Sparkles, X } from "lucide-react";

type AgentProduct = {
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

type AgentReview = {
  id: string;
  reviewer: string;
  rating: number;
  content: string;
  reviewedAt: string;
};

type SearchResponse = {
  products?: AgentProduct[];
  nextCursor?: string | null;
  intentSummary?: string;
};

type DetailResponse = {
  product: AgentProduct;
  reviews: AgentReview[];
};

function formatMinor(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export function AssistantDock({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [products, setProducts] = useState<AgentProduct[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [intentSummary, setIntentSummary] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [aiQuantity, setAiQuantity] = useState(1);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [payingProductId, setPayingProductId] = useState<string | null>(null);
  const [orderReceipt, setOrderReceipt] = useState<{
    orderGroupId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    totalMinor: number;
  } | null>(null);
  const [detailProduct, setDetailProduct] = useState<AgentProduct | null>(null);
  const [detailReviews, setDetailReviews] = useState<AgentReview[]>([]);
  const [detailState, setDetailState] = useState<"loading" | "ready" | "error">("loading");
  const [paymentLinks, setPaymentLinks] = useState<PaymentLinkView[]>([]);
  const [creatingPaymentLinkId, setCreatingPaymentLinkId] = useState<string | null>(null);
  const [deletingPaymentLinkId, setDeletingPaymentLinkId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setPaymentLinks([]);
      return;
    }
    let cancelled = false;
    void listPaymentLinks()
      .then((links) => {
        if (!cancelled) setPaymentLinks(links);
      })
      .catch(() => {
        if (!cancelled) setPaymentLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  function paymentLinkUrl(link: PaymentLinkView) {
    return `${window.location.origin}/handoff/${encodeURIComponent(link.urlToken)}`;
  }

  async function createPaymentLinkForProduct(product: AgentProduct) {
    if (!product.stock) {
      showToast("该商品暂时缺货。", "info");
      return;
    }
    setCreatingPaymentLinkId(product.id);
    try {
      const link = await createPaymentLink(product.id, aiQuantity);
      setPaymentLinks((current) => [link, ...current.filter((item) => item.linkId !== link.linkId)]);
      showToast("支付短链已生成。", "success");
    } catch {
      showToast("支付短链生成失败，请稍后重试。");
    } finally {
      setCreatingPaymentLinkId(null);
    }
  }

  async function removePaymentLink(link: PaymentLinkView) {
    setDeletingPaymentLinkId(link.linkId);
    try {
      await deletePaymentLink(link.linkId);
      setPaymentLinks((current) => current.filter((item) => item.linkId !== link.linkId));
      showToast("支付短链已删除。", "success");
    } catch {
      showToast("支付短链删除失败，请稍后重试。");
    } finally {
      setDeletingPaymentLinkId(null);
    }
  }

  async function copyPaymentLink(link: PaymentLinkView) {
    try {
      await navigator.clipboard.writeText(paymentLinkUrl(link));
      showToast("支付短链已复制。", "success");
    } catch {
      showToast("复制失败，请手动复制链接。", "info");
    }
  }

  async function searchProducts(searchQuery: string, cursor?: string) {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) return;
    setState("loading");
    try {
      const response = await fetch("/api/v1/assistant/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: normalizedQuery, cursor, pageSize: 20 }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("assistant search failed");
      const data = (await response.json()) as SearchResponse;
      setProducts((current) =>
        cursor ? [...current, ...(data.products ?? [])] : (data.products ?? [])
      );
      setNextCursor(data.nextCursor ?? null);
      setIntentSummary(data.intentSummary ?? "");
      setSubmittedQuery(normalizedQuery);
      setState("ready");
    } catch {
      setState("error");
      showToast("助手暂时无法完成查询，请稍后重试。");
    }
  }

  async function openDetail(product: AgentProduct) {
    setDetailProduct(product);
    setDetailReviews([]);
    setDetailState("loading");
    try {
      const response = await fetch(
        `/api/v1/products/detail?productId=${encodeURIComponent(product.id)}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("detail request failed");
      const data = (await response.json()) as DetailResponse;
      setDetailProduct(data.product ?? product);
      setDetailReviews(Array.isArray(data.reviews) ? data.reviews : []);
      setDetailState("ready");
    } catch {
      setDetailState("error");
      showToast("商品详情暂时无法加载，请稍后重试。");
    }
  }

  async function refreshProductAfterOrder(productId: string): Promise<boolean> {
    const response = await fetch(
      `/api/v1/products/detail?productId=${encodeURIComponent(productId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return false;
    const data = (await response.json()) as DetailResponse;
    if (!data.product) return false;
    setProducts((current) =>
      current.map((item) => (item.id === productId ? data.product : item)),
    );
    setDetailProduct((current) => (current?.id === productId ? data.product : current));
    return true;
  }

  async function addToCart(product: AgentProduct) {
    if (!product.stock) {
      showToast("该商品暂时缺货。", "info");
      return;
    }
    setAddingId(product.id);
    try {
      const result = await addToCartAndPersist(
        { id: product.id, quantity: aiQuantity, sku: product.id },
        product.stock
      );
      setAddedId(product.id);
      showToast(result.reachedLimit ? "已达到库存上限，已加入可用数量。" : "已加入购物车。", "success");
      window.setTimeout(() => setAddedId((id) => (id === product.id ? null : id)), 1600);
    } catch {
      showToast("加入购物车失败，请稍后重试。");
    } finally {
      setAddingId(null);
    }
  }

  async function payForProduct(product: AgentProduct) {
    if (!product.stock) {
      showToast("该商品暂时缺货。", "info");
      return;
    }
    setPayingProductId(product.id);
    try {
      const cart = await reconcileAiCart([{ id: product.id, quantity: aiQuantity }]);
      if (cart.fullyOutOfStock || !cart.allocations.some((item) => item.allocatedQuantity > 0)) {
        showToast("当前商品暂时无库存，请稍后重试。", "info");
        setPayingProductId(null);
        return;
      }
      const quote = await quoteAiCart(cart.cartVersion);
      const order = await submitAiOrder(cart.cartVersion, quote.quote.quoteId);
      const allocatedQuantity = cart.allocations.reduce((sum, item) => sum + item.allocatedQuantity, 0);
      try {
        const refreshed = await refreshProductAfterOrder(product.id);
        if (!refreshed) showToast("订单已建立，但商品库存刷新失败，请稍后刷新页面。");
      } catch {
        showToast("订单已建立，但商品库存刷新失败，请稍后刷新页面。");
      }
      setOrderReceipt({
        orderGroupId: order.orderGroupId,
        productName: product.name,
        quantity: allocatedQuantity,
        unitPrice: product.price,
        subtotalMinor: quote.quote.subtotalMinor,
        discountMinor: quote.quote.discountMinor,
        shippingMinor: quote.quote.shippingMinor,
        totalMinor: quote.quote.totalDueMinor,
      });
      setPayingProductId(null);
    } catch {
      showToast("下单失败，请稍后重试。");
      setPayingProductId(null);
    }
  }

  return (
    <div className={`assistant-column${paymentLinks.length ? " assistant-column--with-links" : ""}`}>
      {paymentLinks.length ? (
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
                    <button className="assistant-text-link assistant-text-link--danger" type="button" disabled={deletingPaymentLinkId === link.linkId} onClick={() => void removePaymentLink(link)}>
                      {deletingPaymentLinkId === link.linkId ? "删除中..." : "删除"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <aside
        className={`assistant-dock${embedded ? " assistant-dock--embedded" : ""}`}
        aria-label="AI 购物助手"
      >
        <div className="assistant-dock__header">
          <div className="assistant-dock__title">
            <Bot size={18} />
            <strong>AI购物助手</strong>
          </div>
        </div>
        <div className="assistant-dock__body">
          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault();
              const nextQuery = query.trim();
              if (!nextQuery) return;
              setSubmittedQuery(nextQuery);
              setProducts([]);
              setNextCursor(null);
              setIntentSummary("");
              void searchProducts(nextQuery);
            }}
          >
            <label className="sr-only" htmlFor="assistant-query">
              描述你想找的商品
            </label>
            <input
              id="assistant-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：适合通勤的降噪耳机"
              maxLength={1000}
            />
            <button type="submit" aria-label="查找商品" disabled={state === "loading"}>
              <ArrowRight size={18} />
            </button>
          </form>

          {submittedQuery ? (
            <div className="assistant-query-meta">
              <p className="assistant-intent-summary">
                {intentSummary || `正在理解“${submittedQuery}”`}
              </p>
              <span className="assistant-result-count">
                {state === "loading" && !products.length
                  ? "正在查询..."
                  : products.length
                    ? `相关商品 ${products.length} 件`
                    : state === "ready"
                      ? "暂无相关商品"
                      : ""}
              </span>
            </div>
          ) : null}
          <div className="assistant-dock__results">
            {state === "idle" ? (
              <div className="assistant-empty assistant-empty--idle">
                <div className="assistant-empty__icon"><Sparkles size={24} strokeWidth={1.7} /></div>
                <strong>描述一下你想找的好物</strong>
                <p>告诉我预算、场景或偏好，我会从商品里帮你筛选。</p>
                <div className="assistant-suggestions" aria-label="快捷查询">
                  {["通勤降噪耳机", "桌面收纳好物", "适合送人的礼物"].map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => setQuery(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {state === "loading" && !products.length ? (
              <p className="assistant-empty">正在查询商品和库存...</p>
            ) : null}
            {state === "error" ? (
              <div className="assistant-empty">
                <p>助手暂时无法完成查询。</p>
                <button
                  className="button button--soft"
                  type="button"
                  onClick={() => void searchProducts(submittedQuery)}
                >
                  重试
                </button>
              </div>
            ) : null}
            {state === "ready" && !products.length ? (
              <p className="assistant-empty">没有找到符合描述的商品，请换一种说法。</p>
            ) : null}
            {products.map((product) => (
              <div className="assistant-result" key={product.id}>
                <span className="assistant-result__content">
                  <span className="assistant-result__title-row">
                    <span className="assistant-result__title">{product.name}</span>
                    <button
                      type="button"
                      className="assistant-text-link"
                      onClick={() => void openDetail(product)}
                    >
                      详情
                    </button>
                  </span>
                  <div>
                    <span className="assistant-result__price">
                      NT${product.price.toLocaleString()}
                    </span>
                    <span className="assistant-result__meta">
                      {product.stock ? ` · 库存 ${product.stock}` : " · 暂时缺货"}
                    </span>
                  </div>
                  <span className="assistant-result__actions">
                    <label className="assistant-quantity">
                      数量
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={aiQuantity}
                        onChange={(event) =>
                          setAiQuantity(Math.max(1, Math.min(99, Number(event.target.value) || 1)))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="assistant-text-link"
                      onClick={() => void addToCart(product)}
                      disabled={!product.stock || addingId === product.id}
                    >
                      {addingId === product.id
                        ? "加入中..."
                        : addedId === product.id
                          ? "已加入"
                          : "加入购物车"}
                    </button>
                    <button
                      type="button"
                      className="assistant-text-link"
                      onClick={() => void payForProduct(product)}
                      disabled={!product.stock || payingProductId !== null}
                    >
                      {payingProductId === product.id ? "处理中..." : "付款"}
                    </button>
                    <button
                      type="button"
                      className="assistant-text-link"
                      onClick={() => void createPaymentLinkForProduct(product)}
                      disabled={!product.stock || creatingPaymentLinkId !== null}
                    >
                      {creatingPaymentLinkId === product.id ? "生成中..." : "生成支付短链"}
                    </button>
                  </span>
                </span>
              </div>
            ))}
            {nextCursor ? (
              <button
                className="assistant-more"
                type="button"
                disabled={state === "loading"}
                onClick={() => void searchProducts(submittedQuery, nextCursor)}
              >
                {state === "loading" ? "正在加载..." : "加载更多商品"}
              </button>
            ) : null}
          </div>

        </div>
      </aside>

      {detailProduct ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="商品详情"
          onClick={() => setDetailProduct(null)}
        >
          <div className="assistant-detail-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="auth-dialog__header">
              <h2>{detailProduct.name}</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setDetailProduct(null)}
                aria-label="关闭详情"
              >
                <X size={18} />
              </button>
            </div>
            <div className="assistant-detail__body">
              {detailState === "loading" ? (
                <p className="assistant-empty">正在加载商品详情...</p>
              ) : null}
              {detailState === "error" ? (
                <p className="assistant-empty">详情暂时无法加载，请稍后重试。</p>
              ) : null}
              {detailState === "ready" ? (
                <>
                  <div>
                    <p className="assistant-detail__price">
                      NT${detailProduct.price.toLocaleString()}
                    </p>
                    <p className="assistant-detail__meta">
                      {detailProduct.brand || "品牌待补充"} · {detailProduct.category}
                      {detailProduct.rating ? ` · ★ ${detailProduct.rating}` : ""} ·{" "}
                      {detailProduct.reviewCount} 条评论
                    </p>
                  </div>
                  <p className="assistant-detail__desc">{detailProduct.description}</p>
                  <div className="assistant-detail__specs">
                    {Object.entries(detailProduct.specs ?? {}).map(([key, value]) => (
                      <span className="tag" key={key}>
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                  <div className="assistant-detail__reviews">
                    <strong>用户评价（{detailReviews.length}）</strong>
                    {detailReviews.length ? (
                      detailReviews.map((review) => (
                        <article className="assistant-review" key={review.id}>
                          <div>
                            <strong>{review.reviewer}</strong>
                            <span>
                              ★ {review.rating} · {review.reviewedAt}
                            </span>
                          </div>
                          <p>{review.content}</p>
                        </article>
                      ))
                    ) : (
                      <p className="assistant-empty">暂无公开评论。</p>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {orderReceipt ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="订单回执"
          onClick={() => setOrderReceipt(null)}
        >
          <div className="auth-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="auth-dialog__header">
              <h2>下单成功</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setOrderReceipt(null)}
                aria-label="关闭回执"
              >
                <X size={18} />
              </button>
            </div>
            <div className="assistant-detail__body">
              <div className="list-item">
                <div>
                  <p className="list-item__title">{orderReceipt.productName}</p>
                  <p className="list-item__meta">
                    数量：{orderReceipt.quantity} · 单价：NT${orderReceipt.unitPrice.toLocaleString()}
                  </p>
                </div>
                <strong>
                  {formatMinor(orderReceipt.subtotalMinor)}
                </strong>
              </div>
              <div className="cart-summary__line">
                <span>商品小计</span>
                <strong>{formatMinor(orderReceipt.subtotalMinor)}</strong>
              </div>
              <div className="cart-summary__line">
                <span>优惠</span>
                <strong>{formatMinor(orderReceipt.discountMinor)}</strong>
              </div>
              <div className="cart-summary__line">
                <span>运费</span>
                <strong>{formatMinor(orderReceipt.shippingMinor)}</strong>
              </div>
              <div className="cart-summary__total">
                <span>订单金额</span>
                <strong>{formatMinor(orderReceipt.totalMinor)}</strong>
              </div>
              <p className="assistant-detail__meta">订单编号：{orderReceipt.orderGroupId}</p>
              <div className="assistant-result__actions">
                <button
                  className="button button--soft"
                  type="button"
                  onClick={() => {
                    setOrderReceipt(null);
                    router.push("/account/orders");
                  }}
                >
                  查看订单
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => setOrderReceipt(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
