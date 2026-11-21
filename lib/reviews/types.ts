export type ReviewSnapshot = {
  productId: string;
  maxReviewId: string;
  total: number;
  asOf: string;
};
export type ReviewCitation = {
  reviewId: string;
  reviewer: string;
  rating: number;
  reviewedAt: string;
  quote: string;
};
export type ReviewFinding = {
  key: string;
  polarity: "positive" | "negative" | "mixed";
  topic: string;
  statement: string;
  reviewIds: string[];
  citations: ReviewCitation[];
};
export type ReviewInsight = {
  topic: string;
  statement: string;
  mentionCount: number;
  citations: ReviewCitation[];
};
export type ReviewAnalysisReport = {
  analysisId: string;
  productId: string;
  productName: string;
  question: string;
  status: "running" | "partial" | "complete" | "empty";
  snapshotAt: string;
  updatedAt: string;
  total: number;
  readCount: number;
  analyzedCount: number;
  complete: boolean;
  ratingCounts: Record<string, number>;
  positives: ReviewInsight[];
  negatives: ReviewInsight[];
  mixed: ReviewInsight[];
  answer?: string;
  answerCitations?: ReviewCitation[];
  limitations: string[];
  canContinue: boolean;
  reused: boolean;
};

// 仅存在任务 data_json 内，不通过 taskView 暴露租约、游标与完整主题索引。
export type ReviewAnalysisProgress = {
  version: 1;
  analysisId: string;
  productId: string;
  productName: string;
  question: string;
  snapshot?: ReviewSnapshot;
  cursor?: string | null;
  readCount: number;
  analyzedCount: number;
  ratingCounts: Record<string, number>;
  findings: ReviewFinding[];
  droppedFindings: number;
  rejectedEvidence: number;
  status: ReviewAnalysisReport["status"];
  error?: string;
  startedAt: string;
  updatedAt: string;
  operationToken: string | null;
  operationStartedAt: string | null;
  lastReviewId?: string;
  pendingReview?: {
    reviewId: string;
    contentHash: string;
    nextOffset: number;
    findings: ReviewFinding[];
    droppedFindings: number;
    rejectedEvidence: number;
  };
  errorCode?: "source_changed" | "read_failed" | "model_failed" | "deadline";
};
export const REVIEW_LEASE_MS = 180_000;
