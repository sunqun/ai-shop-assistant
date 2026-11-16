"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import type { CatalogProduct, CatalogReview } from "@/lib/catalog";
import { addToCartAndPersist } from "@/lib/cart-client";

type DetailResponse = {
  product: CatalogProduct;
  reviews: CatalogReview[];
};

const TONE_VISUALS: Record<string, { from: string; to: string; ink: string }> = {
  office: { from: "#e3e9ee", to: "#f7f9fb", ink: "#43566c" },
  media: { from: "#eae5ee", to: "#faf8fc", ink: "#6b5873" },
  travel: { from: "#e2ece4", to: "#f4faf5", ink: "#3e6a49" },
  kitchen: { from: "#f0e8dc", to: "#fbf7f0", ink: "#98603a" },
  home: { from: "#f1ebd6", to: "#fbf8ee", ink: "#88733a" },
  fitness: { from: "#e0ebe9", to: "#f2f9f8", ink: "#3d6d66" },
};

export default function ProductDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const { productId } = use(searchParams);
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [reviews, setReviews] = useState<CatalogReview[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addMessage, setAddMessage] = useState("");

  useEffect(() => {
    let active = true;
    setState("loading");
    setProduct(null);
    setReviews([]);
    setQuantity(1);
    setAdded(false);

    if (!productId) {
      setState("notfound");
      return () => {
        active = false;
      };
    }
    const id = productId;
    async function load() {
      try {
        const response = await fetch(
          `/api/v1/products/detail?productId=${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );
        if (!active) return;
        if (response.status === 404) {
          setState("notfound");
          return;
        }
        if (!response.ok) throw new Error("product request failed");
        const data = (await response.json()) as DetailResponse;
        if (!active) return;
        setProduct(data.product);
        setReviews(Array.isArray(data.reviews) ? data.reviews : []);
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [productId]);

  if (state === "loading") {
    return (
      <PageShell eyebrow="商品详情" title="正在加载">
        <div className="empty-state">
          <p>正在读取商品信息...</p>
        </div>
      </PageShell>
    );
  }

  if (state === "notfound") {
    return (
      <PageShell eyebrow="商品详情" title="商品不存在">
        <div className="empty-state">
          <p>这件商品可能已下架或链接已失效。</p>
          <Link className="button button--primary" href="/">
            返回商品列表
          </Link>
        </div>
      </PageShell>
    );
  }

  if (state === "error" || !product) {
    return (
      <PageShell eyebrow="商品详情" title="加载失败">
        <div className="empty-state">
          <p>商品信息暂时无法加载，请稍后重试。</p>
          <Link className="button button--primary" href="/">
            返回商品列表
          </Link>
        </div>
      </PageShell>
    );
  }

  const currentProduct = product;

  async function add() {
    const selectedQuantity = Math.max(1, Math.min(quantity, currentProduct.stock));
    setAdding(true);
    setAddMessage("");
    try {
      const result = await addToCartAndPersist(
        { id: currentProduct.id, quantity: selectedQuantity, sku: currentProduct.id },
        currentProduct.stock,
      );
      setAdded(true);
      setAddMessage(
        result.reachedLimit ? "已达到库存上限，已加入可用数量。" : "已加入购物车。",
      );
    } catch (error) {
      setAddMessage(error instanceof Error ? error.message : "加入购物车失败，请稍后重试。");
    } finally {
      setAdding(false);
    }
  }

  const specs = Object.entries(currentProduct.specs);
  const toneVisual = TONE_VISUALS[currentProduct.tone] ?? TONE_VISUALS.office;

  return (
    <PageShell eyebrow="商品详情" title={currentProduct.name} description={currentProduct.description}>
      <div className="product-detail">
        <section className="card product-detail__gallery">
          <div
            className="product-detail__visual"
            style={{
              background: `linear-gradient(135deg, ${toneVisual.from}, ${toneVisual.to})`,
              color: toneVisual.ink,
            }}
          >
            <span className="product-detail__visual-badge">{currentProduct.category}</span>
            <span className="product-detail__visual-letter" aria-hidden="true">
              {currentProduct.name.slice(0, 1)}
            </span>
            <span className="product-detail__visual-brand">{currentProduct.brand || "优选商品"}</span>
          </div>
          <div className="product-detail__specs">
            {specs.map(([key, value]) => (
              <span className="tag" key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
        </section>

        <aside className="card product-detail__info">
          <div className="product-detail__meta">
            <span className={`category-badge category-badge--${currentProduct.tone || "all"}`}>
              {currentProduct.category}
            </span>
            <span className="product-detail__rating" aria-label={`评分 ${currentProduct.rating || "暂无"}`}>
              {currentProduct.rating ? "★".repeat(Math.round(currentProduct.rating)) : "暂无评分"}
              {currentProduct.rating ? <em>{currentProduct.rating}</em> : null}
            </span>
            <span className="muted">{currentProduct.reviewCount} 条评论</span>
          </div>

          <div className="product-detail__price-row">
            <span className="product-detail__price">NT${currentProduct.price.toLocaleString()}</span>
            <span className={currentProduct.stock ? "stock stock--in" : "stock stock--out"}>
              {currentProduct.stock ? `库存 ${currentProduct.stock} 件` : "暂时缺货"}
            </span>
          </div>

          <div className="field">
            <label htmlFor="quantity">购买数量</label>
            <input
              id="quantity"
              type="number"
              min="1"
              max={currentProduct.stock || 1}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            />
          </div>

          <button
            className={added ? "button button--added" : "button button--primary"}
            onClick={add}
            disabled={!currentProduct.stock || adding}
          >
            {adding ? "处理中…" : added ? "已加入购物车" : "加入购物车"}
          </button>
          {addMessage ? <p className="notice" role="status" aria-live="polite">{addMessage}</p> : null}

          <ul className="product-detail__facts">
            <li><span>品牌</span><strong>{currentProduct.brand || "品牌信息待补充"}</strong></li>
            <li><span>品类</span><strong>{currentProduct.category}</strong></li>
            <li><span>商品编号</span><strong>{currentProduct.id}</strong></li>
          </ul>
        </aside>
      </div>

      <section className="section">
        <div className="section__heading">
          <h2>用户评价</h2>
          <span className="muted">{reviews.length} 条公开评论</span>
        </div>
        {reviews.length ? (
          <div className="review-list">
            {reviews.map((review) => (
              <article className="review-item" key={review.id}>
                <span className="review-item__avatar" aria-hidden="true">
                  {review.reviewer.slice(0, 1)}
                </span>
                <div>
                  <div className="review-item__head">
                    <span className="review-item__reviewer">{review.reviewer}</span>
                    <span className="review-item__date">{review.reviewedAt}</span>
                  </div>
                  <span className="review-item__stars" aria-label={`评分 ${review.rating}`}>
                    {"★".repeat(Math.round(review.rating))}
                  </span>
                  <p className="review-item__content">{review.content}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">暂无公开评价。</div>
        )}
      </section>
    </PageShell>
  );
}
