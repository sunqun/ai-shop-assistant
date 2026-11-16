"use client";

import Link from "next/link";
import { useRef, useState } from "react";

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

type ReviewResponse = {
  reviews?: AgentReview[];
  nextCursor?: string | null;
};

export function AssistantDock({ embedded = false }: { embedded?: boolean }) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [products, setProducts] = useState<AgentProduct[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [intentSummary, setIntentSummary] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [launcherPosition, setLauncherPosition] = useState<{ x: number; y: number } | null>(null);
  const [reviewProduct, setReviewProduct] = useState<AgentProduct | null>(null);
  const [reviews, setReviews] = useState<AgentReview[]>([]);
  const [reviewCursor, setReviewCursor] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "error">("idle");
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

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
      setProducts((current) => (cursor ? [...current, ...(data.products ?? [])] : data.products ?? []));
      setNextCursor(data.nextCursor ?? null);
      setIntentSummary(data.intentSummary ?? "");
      setSubmittedQuery(normalizedQuery);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  async function openReviews(product: AgentProduct) {
    setReviewProduct(product);
    setReviews([]);
    setReviewCursor(null);
    setReviewState("loading");
    try {
      const response = await fetch(`/api/v1/products/${encodeURIComponent(product.id)}/reviews?pageSize=20`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("reviews request failed");
      const data = (await response.json()) as ReviewResponse;
      setReviews(data.reviews ?? []);
      setReviewCursor(data.nextCursor ?? null);
      setReviewState("idle");
    } catch {
      setReviewState("error");
    }
  }

  async function loadMoreReviews() {
    if (!reviewProduct || !reviewCursor) return;
    setReviewState("loading");
    try {
      const response = await fetch(
        `/api/v1/products/${encodeURIComponent(reviewProduct.id)}/reviews?pageSize=20&cursor=${encodeURIComponent(reviewCursor)}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("reviews request failed");
      const data = (await response.json()) as ReviewResponse;
      setReviews((current) => [...current, ...(data.reviews ?? [])]);
      setReviewCursor(data.nextCursor ?? null);
      setReviewState("idle");
    } catch {
      setReviewState("error");
    }
  }

  if (!open) {
    return (
      <button
        className={`assistant-launcher${embedded ? " assistant-launcher--embedded" : ""}`}
        type="button"
        onClick={() => setOpen(true)}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          dragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          const size = 56;
          setLauncherPosition({
            x: Math.max(8, Math.min(window.innerWidth - size - 8, event.clientX - dragRef.current.offsetX)),
            y: Math.max(72, Math.min(window.innerHeight - size - 8, event.clientY - dragRef.current.offsetY)),
          });
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        }}
        style={launcherPosition ? { left: launcherPosition.x, top: launcherPosition.y, right: "auto", bottom: "auto" } : undefined}
        aria-label="打开 AI 购物助手"
      >
        <span aria-hidden="true">✦</span>
      </button>
    );
  }

  return (
    <aside className={`assistant-dock${embedded ? " assistant-dock--embedded" : ""}`} aria-label="AI 购物助手">
      <div className="assistant-dock__header">
        <div>
          <strong>AI 购物助手</strong>
          <span>描述需求，我会从真实商品中查找</span>
        </div>
        <button className="assistant-collapse" type="button" onClick={() => setOpen(false)} aria-label="收起 AI 购物助手">
          −
        </button>
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
          <label className="sr-only" htmlFor="assistant-query">描述你想找的商品</label>
          <input
            id="assistant-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：适合通勤的降噪耳机"
            maxLength={1000}
          />
          <button type="submit" aria-label="查找商品" disabled={state === "loading"}>↗</button>
        </form>

        {submittedQuery ? (
          <div className="assistant-query-meta">
            <p className="assistant-intent-summary">{intentSummary || `正在理解“${submittedQuery}”`}</p>
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
          {state === "idle" ? <p className="assistant-empty">告诉我用途、预算或规格，我会帮你查找商品。</p> : null}
          {state === "loading" && !products.length ? <p className="assistant-empty">正在查询商品和库存...</p> : null}
          {state === "error" ? (
            <div className="assistant-empty">
              <p>助手暂时无法完成查询。</p>
              <button className="button button--soft" type="button" onClick={() => void searchProducts(submittedQuery)}>重试</button>
            </div>
          ) : null}
          {state === "ready" && !products.length ? <p className="assistant-empty">没有找到符合描述的商品，请换一种说法。</p> : null}
          {products.map((product) => (
            <article className="assistant-result" key={product.id}>
              <span className="assistant-result__swatch">{product.name.slice(0, 1)}</span>
              <span className="assistant-result__content">
                <Link href={`/products/${product.id}`} className="assistant-result__title">{product.name}</Link>
                <small>{product.category} · {product.brand || "品牌信息待补充"}</small>
                <small>{product.currency}{product.price.toLocaleString()} · {product.stock ? `库存 ${product.stock}` : "暂时缺货"}</small>
                <small>{product.rating ? `★ ${product.rating}` : "暂无评分"} · {product.reviewCount} 条评论</small>
                <span className="assistant-result__actions">
                  <Link href={`/products/${product.id}`} className="assistant-text-link">查看规格</Link>
                  <button type="button" className="assistant-text-link" onClick={() => void openReviews(product)}>查看评论</button>
                </span>
              </span>
            </article>
          ))}
          {nextCursor ? (
            <button className="assistant-more" type="button" disabled={state === "loading"} onClick={() => void searchProducts(submittedQuery, nextCursor)}>
              {state === "loading" ? "正在加载..." : "加载更多商品"}
            </button>
          ) : null}
        </div>

        {reviewProduct ? (
          <section className="assistant-reviews" aria-label={`${reviewProduct.name} 的评论`}>
            <div className="assistant-reviews__header">
              <strong>{reviewProduct.name} 的评论</strong>
              <button type="button" className="assistant-text-link" onClick={() => setReviewProduct(null)}>关闭</button>
            </div>
            {reviewState === "loading" && !reviews.length ? <p className="assistant-empty">正在加载评论...</p> : null}
            {reviewState === "error" ? <p className="assistant-empty">评论暂时无法加载，请重试。</p> : null}
            {reviewState !== "error" && !reviews.length && reviewState !== "loading" ? <p className="assistant-empty">暂无公开评论。</p> : null}
            {reviews.map((review) => (
              <article className="assistant-review" key={review.id}>
                <div><strong>{review.reviewer}</strong><span>★ {review.rating} · {review.reviewedAt}</span></div>
                <p>{review.content}</p>
              </article>
            ))}
            {reviewCursor ? <button className="assistant-more" type="button" disabled={reviewState === "loading"} onClick={() => void loadMoreReviews()}>加载更多评论</button> : null}
          </section>
        ) : null}
        <p className="assistant-disclaimer">商品信息、库存和评论来自服务端实时查询。</p>
      </div>
    </aside>
  );
}
