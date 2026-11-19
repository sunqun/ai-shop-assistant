"use client";

import { X } from "lucide-react";
import type { AgentProduct, AgentReview } from "./types";

export function ProductDetailDialog({
  product,
  reviews,
  state,
  onClose,
}: {
  product: AgentProduct;
  reviews: AgentReview[];
  state: "loading" | "ready" | "error";
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="商品详情"
      onClick={onClose}
    >
      <div className="assistant-detail-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="auth-dialog__header">
          <h2>{product.name}</h2>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
          >
            <X size={18} />
          </button>
        </div>
        <div className="assistant-detail__body">
          {state === "loading" ? (
            <p className="assistant-empty">正在加载商品详情...</p>
          ) : null}
          {state === "error" ? (
            <p className="assistant-empty">详情暂时无法加载，请稍后重试。</p>
          ) : null}
          {state === "ready" ? (
            <>
              <div>
                <p className="assistant-detail__price">
                  NT${product.price.toLocaleString()}
                </p>
                <p className="assistant-detail__meta">
                  {product.brand || "品牌待补充"} · {product.category}
                  {product.rating ? ` · ★ ${product.rating}` : ""} ·{" "}
                  {product.reviewCount} 条评论
                </p>
              </div>
              <p className="assistant-detail__desc">{product.description}</p>
              <div className="assistant-detail__specs">
                {Object.entries(product.specs ?? {}).map(([key, value]) => (
                  <span className="tag" key={key}>
                    {key}: {value}
                  </span>
                ))}
              </div>
              <div className="assistant-detail__reviews">
                <strong>用户评价（{reviews.length}）</strong>
                {reviews.length ? (
                  reviews.map((review) => (
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
  );
}
