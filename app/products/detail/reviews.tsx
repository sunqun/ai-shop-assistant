import type { CatalogReview } from "./type";

export function Reviews({ reviews }: { reviews: CatalogReview[] }) {
  return (
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
  );
}
