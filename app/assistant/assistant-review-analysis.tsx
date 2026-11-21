"use client";

import { useState } from "react";
import type { CatalogReview } from "@/lib/catalog";
import type { ReviewAnalysisReport, ReviewCitation, ReviewInsight } from "@/lib/reviews/types";
import { getReviewPageRequest, getReviewSourceRequest } from "./api";

export function AssistantReviewAnalysis({
  report,
  onAsk,
  disabled,
}: {
  report: ReviewAnalysisReport;
  onAsk: (query: string) => void;
  disabled: boolean;
}) {
  const [source, setSource] = useState<CatalogReview | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [reviews, setReviews] = useState<CatalogReview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  async function openSource(citation: ReviewCitation) {
    if (sourceLoading) return;
    setSourceLoading(true);
    setSourceError("");
    const result = await getReviewSourceRequest(report.productId, citation.reviewId);
    if (result.success) setSource(result.data.review);
    else {
      setSource(null);
      setSourceError(result.errorMsg);
    }
    setSourceLoading(false);
  }
  async function loadPage() {
    if (pageLoading || (loaded && !cursor)) return;
    setPageLoading(true);
    setPageError("");
    const result = await getReviewPageRequest(
      report.productId,
      loaded ? (cursor ?? undefined) : undefined
    );
    if (result.success) {
      setReviews((items) => [
        ...new Map(
          [...items, ...result.data.reviews].map((review) => [review.id, review])
        ).values(),
      ]);
      setCursor(result.data.nextCursor);
      setLoaded(true);
    } else setPageError(result.errorMsg);
    setPageLoading(false);
  }
  const citations = (items: ReviewCitation[]) => (
    <ul className="agent-reviews__citations">
      {items.map((citation) => (
        <li key={citation.reviewId}>
          <q>{citation.quote}</q>
          <span>
            {citation.rating} 星 · {citation.reviewedAt} · {citation.reviewer}
          </span>
          <button type="button" disabled={sourceLoading} onClick={() => void openSource(citation)}>
            查看原评论 #{citation.reviewId}
          </button>
        </li>
      ))}
    </ul>
  );
  const insights = (label: string, items: ReviewInsight[]) =>
    items.length ? (
      <section>
        <h3>{label}</h3>
        {items.map((item, index) => (
          <div className="agent-reviews__insight" key={`${item.topic}-${index}`}>
            <strong>{item.topic}</strong>
            <span className="agent-reviews__count">已分析评论中有 {item.mentionCount} 条提及</span>
            <p>{item.statement}</p>
            {citations(item.citations)}
          </div>
        ))}
      </section>
    ) : null;
  return (
    <section className="agent-reviews" aria-label={`${report.productName}的评论分析`}>
      <header>
        <strong>{report.productName} · 评论分析</strong>
        <span>
          {report.status === "running"
            ? "分析进行中"
            : report.complete
              ? "本次范围已完成"
              : "部分结果"}
          {report.reused ? " · 已复用历史分析" : ""}
        </span>
      </header>
      <p className="agent-reviews__coverage">
        已读取 {report.readCount}/{report.total} 条，已分析 {report.analyzedCount}/{report.total}{" "}
        条。范围建立于 {new Date(report.snapshotAt).toLocaleString("zh-CN")}。
      </p>
      {report.answer ? (
        <div className="agent-reviews__answer">
          <p>{report.answer}</p>
          {citations(report.answerCitations ?? [])}
        </div>
      ) : null}
      {insights("正面体验", report.positives)}
      {insights("主要问题与负面体验", report.negatives)}
      {insights("分歧与混合反馈", report.mixed)}
      {report.analyzedCount > 0 &&
      !report.positives.length &&
      !report.negatives.length &&
      !report.mixed.length ? (
        <p>已分析部分未提炼出可核实原文的使用体验，不据此推断好评或差评。</p>
      ) : null}
      {report.analyzedCount > 0 ? (
        <details>
          <summary>已分析评论的评分分布</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">评分</th>
                <th scope="col">条数</th>
              </tr>
            </thead>
            <tbody>
              {[5, 4, 3, 2, 1].map((rating) => (
                <tr key={rating}>
                  <th scope="row">{rating} 星</th>
                  <td>{report.ratingCounts[String(rating)] ?? 0}</td>
                </tr>
              ))}
              {report.ratingCounts.unrated ? (
                <tr>
                  <th scope="row">评分缺失或无效</th>
                  <td>{report.ratingCounts.unrated}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </details>
      ) : null}
      <ul className="agent-reviews__limitations">
        {report.limitations.map((limitation, index) => (
          <li key={index}>{limitation}</li>
        ))}
      </ul>
      {sourceLoading ? <p role="status">正在读取原评论…</p> : null}
      {sourceError ? <p role="alert">{sourceError}</p> : null}
      {source ? (
        <aside className="agent-reviews__source">
          <strong>
            原评论 #{source.id} · {source.rating} 星
          </strong>
          <span>
            {source.reviewer} · {source.reviewedAt}
          </span>
          <p>{source.content || "该评论没有文字内容。"}</p>
          <small>此处为当前公开原文，可能与分析时的摘录版本不同。</small>
          <button type="button" onClick={() => setSource(null)}>
            收起原评论
          </button>
        </aside>
      ) : null}
      <details
        onToggle={(event) => {
          if (event.currentTarget.open && !loaded && !pageLoading) void loadPage();
        }}
      >
        <summary>浏览该商品全部公开评论（分页）</summary>
        <p>以下读取当前评论列表，新增或编辑内容可能晚于本次分析范围。</p>
        {reviews.map((review) => (
          <article className="agent-reviews__source" key={review.id}>
            <strong>
              #{review.id} · {review.rating} 星
            </strong>
            <span>
              {review.reviewer} · {review.reviewedAt}
            </span>
            <p>{review.content || "该评论没有文字内容。"}</p>
          </article>
        ))}
        {pageLoading ? <p role="status">正在加载评论…</p> : null}
        {pageError ? <p role="alert">{pageError}</p> : null}
        {loaded && !reviews.length ? <p>暂无公开评论。</p> : null}
        {cursor || pageError ? (
          <button type="button" disabled={pageLoading} onClick={() => void loadPage()}>
            {pageError ? "重试读取" : "加载更多评论"}
          </button>
        ) : null}
      </details>
      <div className="agent-reviews__actions">
        {report.canContinue ? (
          <button type="button" disabled={disabled} onClick={() => onAsk("继续分析评论")}>
            继续分析剩余评论
          </button>
        ) : null}
        <button type="button" disabled={disabled} onClick={() => onAsk("重新分析评论")}>
          刷新分析
        </button>
      </div>
    </section>
  );
}
