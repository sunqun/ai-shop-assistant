import { createHash, randomUUID } from "node:crypto";
import { getCatalogProduct, type CatalogReview } from "@/lib/catalog";
import { invokeAgentTool } from "@/lib/agent/tool-registry";
import { getTask, updateTask, ShoppingTaskError } from "@/lib/shop-task/shopping-task-store";
import { CANCELLABLE_PHASES, type ShoppingTask } from "@/lib/shop-task/shopping-task-types";
import { taskView } from "@/lib/shop-task/shopping-task-store";
import {
  analyzeReviewBatch,
  answerReviewQuestion,
  buildReviewReport,
  mergeReviewObservations,
} from "./summarize";
import { REVIEW_LEASE_MS, type ReviewAnalysisProgress, type ReviewAnalysisReport } from "./types";

class AnalysisError extends Error {
  constructor(
    public readonly code: NonNullable<ReviewAnalysisProgress["errorCode"]>,
    message: string
  ) {
    super(message);
  }
}
function groupsOfReviews(reviews: CatalogReview[]): CatalogReview[][] {
  const groups: CatalogReview[][] = [];
  let group: CatalogReview[] = [],
    length = 0;
  for (const review of reviews) {
    if (Array.from(review.content).length > 4000) {
      if (group.length) groups.push(group);
      groups.push([review]);
      group = [];
      length = 0;
      continue;
    }
    if (group.length && (group.length >= 8 || length + review.content.length > 10000)) {
      groups.push(group);
      group = [];
      length = 0;
    }
    group.push(review);
    length += review.content.length;
  }
  if (group.length) groups.push(group);
  return groups;
}

export async function analyzeCurrentProductReviews(input: {
  userid: string;
  taskId: string;
  question: string;
  refresh?: boolean;
}): Promise<{ task: ShoppingTask; report: ReviewAnalysisReport; busy: boolean }> {
  const record = await getTask(input.userid, input.taskId);
  if (!record.data.product)
    throw new ShoppingTaskError("REVIEW_PRODUCT_REQUIRED", "请先确定当前商品，再分析评论。", 400);
  const product = await getCatalogProduct(record.data.product.id);
  if (!product) throw new ShoppingTaskError("PRODUCT_NOT_FOUND", "当前商品已不存在。", 404);
  const token = randomUUID();
  let acquired = false,
    reused = false,
    busy = false;
  const initial = await updateTask(input.userid, input.taskId, (current) => {
    if (current.data.product?.id !== product.id)
      throw new ShoppingTaskError("REVIEW_PRODUCT_CHANGED", "当前商品已变化，请重新确认商品。");
    const previous = current.data.reviewProgress;
    if (CANCELLABLE_PHASES.includes(current.phase))
      current.data.reviewHold = true;
    if (
      previous?.productId === product.id &&
      previous.operationToken &&
      previous.operationStartedAt &&
      Date.now() - Date.parse(previous.operationStartedAt) < REVIEW_LEASE_MS
    ) {
      busy = true;
      return;
    }
    if (
      !input.refresh &&
      previous?.productId === product.id &&
      ["complete", "empty"].includes(previous.status)
    ) {
      reused = true;
      return;
    }
    if (
      !input.refresh &&
      previous?.productId === product.id &&
      previous.errorCode === "source_changed"
    ) {
      reused = true;
      return;
    }
    const now = new Date().toISOString();
    const progress: ReviewAnalysisProgress =
      !input.refresh && previous?.productId === product.id
        ? {
            ...previous,
            operationToken: token,
            operationStartedAt: now,
            status: "running",
            error: undefined,
            errorCode: undefined,
            question: input.question,
          }
        : {
            version: 1,
            analysisId: randomUUID(),
            productId: product.id,
            productName: product.name,
            question: input.question,
            readCount: 0,
            analyzedCount: 0,
            ratingCounts: {},
            findings: [],
            droppedFindings: 0,
            rejectedEvidence: 0,
            status: "running",
            startedAt: now,
            updatedAt: now,
            operationToken: token,
            operationStartedAt: now,
          };
    current.data.reviewProgress = progress;
    current.data.reviewAnalysis = buildReviewReport(progress, input.question);
    acquired = true;
  });
  let progress = JSON.parse(JSON.stringify(initial.data.reviewProgress!)) as ReviewAnalysisProgress;
  if (!progress) throw new Error("Review analysis state missing");
  const started = Date.now();
  const signal = AbortSignal.timeout(70000);
  const persist = async () => {
    progress.updatedAt = new Date().toISOString();
    progress.operationStartedAt = progress.updatedAt;
    await updateTask(input.userid, input.taskId, (current) => {
      if (current.data.reviewProgress?.operationToken !== token) {
        const error = new Error("Review analysis lease lost");
        error.name = "AbortError";
        throw error;
      }
      current.data.reviewProgress = JSON.parse(JSON.stringify(progress)) as ReviewAnalysisProgress;
      current.data.reviewAnalysis = buildReviewReport(progress, input.question);
    });
  };
  if (acquired) {
    try {
      while (true) {
        signal.throwIfAborted();
        const page = await invokeAgentTool("read_product_reviews", {
          productId: product.id,
          pageSize: 50,
          cursor: progress.cursor ?? undefined,
        });
        if (!page.ok) throw new AnalysisError("read_failed", page.error.message);
        const data = page.data;
        if (
          data.snapshot.productId !== product.id ||
          (progress.snapshot &&
            (data.snapshot.maxReviewId !== progress.snapshot.maxReviewId ||
              data.snapshot.total !== progress.snapshot.total ||
              data.snapshot.asOf !== progress.snapshot.asOf)) ||
          data.currentTotal !== data.snapshot.total
        )
          throw new AnalysisError(
            "source_changed",
            "分析期间评论集合发生变化，请刷新分析；当前结果不能视为完整覆盖。"
          );
        progress.snapshot = data.snapshot;
        progress.cursor ??= data.startCursor;
        progress.readCount = Math.min(
          data.snapshot.total,
          Math.max(progress.readCount, progress.analyzedCount + data.reviews.length)
        );
        await persist();
        let previousId = progress.lastReviewId
          ? BigInt(progress.lastReviewId)
          : BigInt(data.snapshot.maxReviewId) + BigInt(1);
        for (const review of data.reviews) {
          if (
            !/^\d{1,20}$/u.test(review.id) ||
            BigInt(review.id) >= previousId ||
            !data.cursorAfter[review.id]
          )
            throw new AnalysisError("read_failed", "评论分页顺序异常，已停止分析以避免重复统计。");
          previousId = BigInt(review.id);
        }
        for (const group of groupsOfReviews(data.reviews)) {
          signal.throwIfAborted();
          if (
            progress.pendingReview &&
            (progress.pendingReview.reviewId !== group[0].id ||
              progress.pendingReview.contentHash !==
                createHash("sha256").update(group[0].content).digest("hex"))
          )
            throw new AnalysisError("source_changed", "续读评论内容发生变化，请刷新分析。");
          const longReview =
            group.length === 1 && Array.from(group[0].content).length > 4000 ? group[0] : undefined;
          if (longReview) {
            const contentHash = createHash("sha256").update(longReview.content).digest("hex");
            if (
              progress.pendingReview &&
              (progress.pendingReview.reviewId !== longReview.id ||
                progress.pendingReview.contentHash !== contentHash)
            )
              throw new AnalysisError("source_changed", "续读评论内容发生变化，请刷新分析。");
            const pending = (progress.pendingReview ??= {
              reviewId: longReview.id,
              contentHash,
              nextOffset: 0,
              findings: [],
              droppedFindings: 0,
              rejectedEvidence: 0,
            });
            const characters = Array.from(longReview.content);
            while (pending.nextOffset < characters.length) {
              signal.throwIfAborted();
              const observations = await analyzeReviewBatch(
                [
                  {
                    ...longReview,
                    content: characters
                      .slice(pending.nextOffset, pending.nextOffset + 4000)
                      .join(""),
                  },
                ],
                signal
              );
              mergeReviewObservations(pending, observations.observations);
              pending.rejectedEvidence += observations.rejectedEvidence;
              pending.nextOffset = Math.min(characters.length, pending.nextOffset + 4000);
              await persist();
            }
            mergeReviewObservations(
              progress,
              pending.findings.flatMap((finding) =>
                finding.citations.map((citation) => ({
                  review: longReview,
                  polarity: finding.polarity,
                  topic: finding.topic,
                  statement: finding.statement,
                  evidence: citation.quote,
                }))
              )
            );
            progress.rejectedEvidence += pending.rejectedEvidence;
            progress.droppedFindings += pending.droppedFindings;
            progress.pendingReview = undefined;
          } else {
            const observations = await analyzeReviewBatch(group, signal);
            mergeReviewObservations(progress, observations.observations);
            progress.rejectedEvidence += observations.rejectedEvidence;
          }
          for (const review of group) {
            const rating =
              Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5
                ? String(review.rating)
                : "unrated";
            progress.ratingCounts[rating] = (progress.ratingCounts[rating] ?? 0) + 1;
          }
          progress.analyzedCount += group.length;
          const last = group[group.length - 1];
          progress.cursor = data.cursorAfter[last.id];
          progress.lastReviewId = last.id;
          await persist();
        }
        if (data.nextCursor === null) {
          if (progress.analyzedCount !== data.snapshot.total)
            throw new AnalysisError(
              "source_changed",
              "实际分析条数与起始评论集合不一致，请刷新分析。"
            );
          const verify = await invokeAgentTool("read_product_reviews", {
            productId: product.id,
            pageSize: 1,
            cursor: progress.cursor ?? undefined,
          });
          if (
            !verify.ok ||
            verify.data.currentTotal !== data.snapshot.total ||
            verify.data.reviews.length !== 0
          )
            throw new AnalysisError(
              "source_changed",
              "结束校验未能确认全部评论已覆盖，请刷新分析。"
            );
          progress.status = progress.analyzedCount ? "complete" : "empty";
          progress.error = undefined;
          progress.errorCode = undefined;
          break;
        }
      }
    } catch (error) {
      progress.status = "partial";
      progress.errorCode =
        error instanceof AnalysisError ? error.code : signal.aborted ? "deadline" : "model_failed";
      progress.error =
        error instanceof AnalysisError
          ? error.message
          : signal.aborted
            ? "本次处理时间已到，尚未完成全部评论分析；可继续读取剩余评论。"
            : "评论分析暂时中断，已保留确认完成的批次，可继续分析。";
    }
    progress.operationToken = null;
    progress.operationStartedAt = null;
    progress.updatedAt = new Date().toISOString();
    await updateTask(input.userid, input.taskId, (current) => {
      if (current.data.reviewProgress?.operationToken !== token) return;
      current.data.reviewProgress = progress;
      current.data.reviewAnalysis = buildReviewReport(progress, input.question);
    });
  }
  const latest = await getTask(input.userid, input.taskId);
  progress = latest.data.reviewProgress ?? progress;
  busy ||= !!progress.operationToken;
  let report = buildReviewReport(progress, input.question, reused);
  if (busy)
    report = {
      ...report,
      limitations: ["该商品已有评论分析正在执行，请稍后再查询或继续。", ...report.limitations],
    };
  if (!busy && progress.findings.length && (reused || Date.now() - started < 65000))
    report = {
      ...report,
      ...(await answerReviewQuestion(progress, input.question, latest.data.dialogue?.intent)),
    };
  if (!busy)
    await updateTask(input.userid, input.taskId, (current) => {
      if (
        current.data.reviewProgress?.analysisId === progress.analysisId &&
        current.data.reviewProgress.updatedAt === progress.updatedAt &&
        !current.data.reviewProgress.operationToken
      )
        current.data.reviewAnalysis = report;
    });
  const finalTask = await getTask(input.userid, input.taskId);
  if (
    finalTask.data.reviewProgress?.analysisId !== progress.analysisId ||
    finalTask.data.reviewProgress.updatedAt !== progress.updatedAt
  ) {
    report =
      finalTask.data.reviewAnalysis ??
      buildReviewReport(finalTask.data.reviewProgress!, input.question);
    busy = !!finalTask.data.reviewProgress?.operationToken;
  }
  return { task: taskView(finalTask), report, busy };
}
