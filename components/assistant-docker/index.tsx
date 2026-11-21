"use client";

/**
 * AI 购物助手 Dock 组件。
 *
 * 提供：自然语言搜商品（带游标分页与历史）、查看商品详情/评论、
 * 加入购物车、直接下单、生成/删除支付短链等操作。
 * 可独立使用，也可通过 embedded 内嵌到其它页面。
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { reconcileAiCartRequest, quoteAiCartRequest, submitAiOrderRequest } from "@/lib/cart-client/api";
import { addToCart as persistCartItem } from "@/lib/cart-client/cart-client";
import { useOptionalAuth } from "@/components/auth";
import {
  createPaymentLinkRequest,
  deletePaymentLinkRequest,
  listPaymentLinksRequest,
} from "./api";
import { showToast } from "@/lib/toast";
import { ArrowRight, Bot, Sparkles } from "lucide-react";
import { getProductDetailRequest, searchProductsRequest } from "./api";
import { PaymentLinks } from "./payment-link";
import { ProductDetailDialog } from "./product-detail";
import { OrderResultDialog } from "./order-result";
import type { AgentProduct, AgentReview, OrderReceipt, PaymentLinkView } from "./types";

export function AssistantDocker({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;
  // 搜索相关状态：输入、已提交查询、结果列表、分页游标、会话、历史。
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searchReply, setSearchReply] = useState("");
  const [products, setProducts] = useState<AgentProduct[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ query: string; summary: string }>>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // 交互相关状态：数量、加购/下单/支付短链的进行中标记。
  const [aiQuantity, setAiQuantity] = useState(1);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [payingProductId, setPayingProductId] = useState<string | null>(null);
  const [orderReceipt, setOrderReceipt] = useState<OrderReceipt | null>(null);
  // 详情弹窗相关状态：商品、评论、加载态。
  const [detailProduct, setDetailProduct] = useState<AgentProduct | null>(null);
  const [detailReviews, setDetailReviews] = useState<AgentReview[]>([]);
  const [detailState, setDetailState] = useState<"loading" | "ready" | "error">("loading");
  // 支付短链列表与增删进行中标记。
  const [paymentLinks, setPaymentLinks] = useState<PaymentLinkView[]>([]);
  const [creatingPaymentLinkId, setCreatingPaymentLinkId] = useState<string | null>(null);
  const [deletingPaymentLinkId, setDeletingPaymentLinkId] = useState<string | null>(null);

  // 登录后加载当前用户的支付短链列表；未登录或用户切换时清空。
  useEffect(() => {
    if (!user) {
      setPaymentLinks([]);
      return;
    }
    let cancelled = false;
    void listPaymentLinksRequest()
      .then((result) => {
        if (cancelled) return;
        if (result.success) setPaymentLinks(result.data);
        else setPaymentLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // 为某商品生成支付短链（数量取当前 aiQuantity）。
  async function createPaymentLinkForProduct(product: AgentProduct) {
    if (!product.stock) {
      showToast("该商品暂时缺货。", "info");
      return;
    }
    setCreatingPaymentLinkId(product.id);
    try {
      const result = await createPaymentLinkRequest(product.id, aiQuantity);
      if (result.success) {
        // 新短链插到最前，并去重同 linkId 的旧条目。
        setPaymentLinks((current) => [result.data, ...current.filter((item) => item.linkId !== result.data.linkId)]);
        showToast("支付短链已生成。", "success");
      }
    } finally {
      setCreatingPaymentLinkId(null);
    }
  }

  // 删除指定支付短链。
  async function removePaymentLink(link: PaymentLinkView) {
    setDeletingPaymentLinkId(link.linkId);
    try {
      const result = await deletePaymentLinkRequest(link.linkId);
      if (result.success) {
        setPaymentLinks((current) => current.filter((item) => item.linkId !== link.linkId));
        showToast("支付短链已删除。", "success");
      }
    } finally {
      setDeletingPaymentLinkId(null);
    }
  }

  // 搜索商品：cursor 为空表示新搜索（重置结果），否则追加下一页。
  async function searchProducts(searchQuery: string, cursor?: string) {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) return;
    setState("loading");
    setSearchReply("");
    const result = await searchProductsRequest(normalizedQuery, cursor, sessionId ?? undefined);
    if (!result.success) {
      setState("error");
      return;
    }
    const data = result.data;
    setSearchReply(data.reply ?? "");
    if (data.sessionId) setSessionId(data.sessionId);
    // 有游标则追加，否则替换为新结果。
    setProducts((current) =>
      cursor ? [...current, ...(data.products ?? [])] : (data.products ?? [])
    );
    setNextCursor(data.nextCursor ?? null);
    setSubmittedQuery(normalizedQuery);
    // 只有新搜索才写入历史，翻页不重复记录。
    if (!cursor) {
      setHistory((current) => [
        ...current,
        { query: normalizedQuery, summary: data.intentSummary ?? "" },
      ]);
    }
    setState("ready");
  }

  // 打开商品详情弹窗，并加载其评论。
  async function openDetail(product: AgentProduct) {
    setDetailProduct(product);
    setDetailReviews([]);
    setDetailState("loading");
    const result = await getProductDetailRequest(product.id);
    if (!result.success) {
      setDetailState("error");
      return;
    }
    setDetailProduct(result.data.product ?? product);
    setDetailReviews(Array.isArray(result.data.reviews) ? result.data.reviews : []);
    setDetailState("ready");
  }

  // 下单后刷新商品库存：同时更新结果列表与详情弹窗里的商品。
  async function refreshProductAfterOrder(productId: string): Promise<boolean> {
    const result = await getProductDetailRequest(productId);
    if (!result.success) return false;
    if (!result.data.product) return false;
    setProducts((current) =>
      current.map((item) => (item.id === productId ? result.data.product : item)),
    );
    setDetailProduct((current) => (current?.id === productId ? result.data.product : current));
    return true;
  }

  // 加入购物车（普通购物车，非 AI 直接下单）。
  async function addToCart(product: AgentProduct) {
    if (!product.stock) {
      showToast("该商品暂时缺货。", "info");
      return;
    }
    setAddingId(product.id);
    try {
      const result = await persistCartItem(
        { id: product.id, quantity: aiQuantity, sku: product.id },
        product.stock
      );
      if (!result.success) return;
      setAddedId(product.id);
      showToast(result.data.reachedLimit ? "已达到库存上限，已加入可用数量。" : "已加入购物车。", "success");
      // 1.6 秒后清除「已加入」提示，恢复按钮文案。
      window.setTimeout(() => setAddedId((id) => (id === product.id ? null : id)), 1600);
    } finally {
      setAddingId(null);
    }
  }

  // 直接下单流程：reconcile（锁定库存）→ quote（核价）→ submit（下单）→ 刷新库存 → 展示订单结果。
  async function payForProduct(product: AgentProduct) {
    if (!product.stock) {
      showToast("该商品暂时缺货。", "info");
      return;
    }
    setPayingProductId(product.id);
    try {
      // 1. 合并 AI 购物车并锁定库存。
      const cartResult = await reconcileAiCartRequest([{ id: product.id, quantity: aiQuantity }]);
      if (!cartResult.success) {
        setPayingProductId(null);
        return;
      }
      const cart = cartResult.data;
      // 全部缺货或没有任何分配数量时中止。
      if (cart.fullyOutOfStock || !cart.allocations.some((item) => item.allocatedQuantity > 0)) {
        showToast("当前商品暂时无库存，请稍后重试。", "info");
        setPayingProductId(null);
        return;
      }
      // 2. 基于购物车版本核价。
      const quoteResult = await quoteAiCartRequest(cart.cartVersion);
      if (!quoteResult.success) {
        setPayingProductId(null);
        return;
      }
      const quote = quoteResult.data;
      // 3. 用核价结果正式下单。
      const orderResult = await submitAiOrderRequest(cart.cartVersion, quote.quote.quoteId);
      if (!orderResult.success) {
        setPayingProductId(null);
        return;
      }
      const order = orderResult.data;
      // 汇总实际分配到的数量（可能受库存上限影响，与 aiQuantity 不一致）。
      const allocatedQuantity = cart.allocations.reduce((sum, item) => sum + item.allocatedQuantity, 0);
      try {
        const refreshed = await refreshProductAfterOrder(product.id);
        if (!refreshed) showToast("订单已建立，但商品库存刷新失败，请稍后刷新页面。");
      } catch {
        showToast("订单已建立，但商品库存刷新失败，请稍后刷新页面。");
      }
      // 构造订单回执，交给 OrderResultDialog 展示。
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
      {/* 有支付短链时，在 Dock 上方并列展示短链列表 */}
      {paymentLinks.length ? (
        <PaymentLinks
          paymentLinks={paymentLinks}
          deletingPaymentLinkId={deletingPaymentLinkId}
          onRemove={removePaymentLink}
        />
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
          {/* 搜索表单：提交时清空旧结果并触发新搜索 */}
          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault();
              const nextQuery = query.trim();
              if (!nextQuery) return;
              setSubmittedQuery(nextQuery);
              setProducts([]);
              setNextCursor(null);
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

          {/* 搜索历史与结果数量提示 */}
          {history.length ? (
            <div className="assistant-history" aria-live="polite">
              {history.map((turn, index) => (
                <div className="assistant-history__turn" key={index}>
                  <p className="assistant-history__query">Q：{turn.query}</p>
                  <p className="assistant-history__summary">
                    A：{turn.summary || "正在理解..."}
                  </p>
                </div>
              ))}
              <span className="assistant-result-count">
                {state === "loading" && !products.length
                  ? "正在查询..."
                  : products.length
                    ? `相关商品 ${products.length} 件`
                    : state === "ready"
                      ? searchReply ? "助理提示" : "暂无相关商品"
                      : ""}
              </span>
            </div>
          ) : null}
          <div className="assistant-dock__results">
            {/* 初始引导态 */}
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
            {/* 加载 / 错误 / 空结果 / 商品列表 */}
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
              <p className="assistant-empty">{searchReply || "没有找到符合描述的商品，请换一种说法。"}</p>
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
                  {/* 数量 + 加购 / 付款 / 生成短链 操作区 */}
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
            {/* 有下一页游标时显示「加载更多」 */}
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

      {/* 商品详情弹窗 */}
      {detailProduct ? (
        <ProductDetailDialog
          product={detailProduct}
          reviews={detailReviews}
          state={detailState}
          onClose={() => setDetailProduct(null)}
        />
      ) : null}

      {/* 下单结果弹窗 */}
      {orderReceipt ? (
        <OrderResultDialog
          receipt={orderReceipt}
          onClose={() => setOrderReceipt(null)}
          onViewOrders={() => {
            setOrderReceipt(null);
            router.push("/orders");
          }}
        />
      ) : null}
    </div>
  );
}
