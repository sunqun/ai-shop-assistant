"use client";

import { useEffect, useState } from "react";
import { ArrowUp, Check, LoaderCircle, X } from "lucide-react";
import { SHOPPING_PHASE_LABELS } from "@/lib/shop-task/shopping-task-types";
import type { AssistantController } from "./use-assistant";

export function AssistantComposer({ controller }: { controller: AssistantController }) {
  const {
    query,
    setQuery,
    canSend,
    inputRef,
    send,
    submit,
    task,
    paused,
    submitting,
    canceling,
    connectionLost,
    confirmOrder,
    cancelToPaymentLink,
    resume,
    refreshTask,
    retryPaymentLink,
    recoverOrder,
    resumeAfterReviews,
  } = controller;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (task?.phase !== "ready_to_order" || !task.commitAfter) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [task?.phase, task?.commitAfter]);
  const seconds = task?.commitAfter
    ? Math.max(0, Math.ceil((Date.parse(task.commitAfter) - now) / 1000))
    : 0;
  const canCancel = task?.canCancel && !submitting;
  const showActions = task && (!task.terminal || task.phase === "canceled_link_failed");

  return (
    <form className="agent-test__composer" onSubmit={submit}>
      {showActions ? (
        <div className="agent-test__confirm" aria-live="polite">
          <span>
            {submitting || task.phase === "committing"
              ? "正在创建订单，已停止接受取消…"
              : task.reviewHold
                ? "已为评论阅读暂停自动提交，阅读后可继续自动流程。"
                : paused
                  ? "已恢复任务，点击继续执行后推进流程。"
                  : task.phase === "ready_to_order"
                    ? `约 ${seconds} 秒后自动创建订单`
                    : SHOPPING_PHASE_LABELS[task.phase]}
          </span>
          <div className="agent-test__confirm-actions">
            {canCancel ? (
              <button
                className="agent-test__cancel"
                type="button"
                disabled={canceling}
                onClick={() => void cancelToPaymentLink()}
              >
                {canceling ? <LoaderCircle size={15} /> : <X size={15} />}
                {canceling ? "正在取消" : "取消并生成短链"}
              </button>
            ) : null}
            {task.canConfirm && !submitting ? (
              <button
                type="button"
                disabled={canceling || connectionLost}
                onClick={() => void confirmOrder()}
              >
                <Check size={15} />
                确认下单
              </button>
            ) : null}
            {task.reviewHold && !submitting ? (
              <button
                type="button"
                disabled={!task.canResumeAfterReviews || connectionLost || canceling}
                onClick={() => void resumeAfterReviews()}
              >
                继续自动流程
              </button>
            ) : null}
            {paused && !task.reviewHold && !submitting ? (
              <button type="button" disabled={connectionLost || canceling} onClick={resume}>
                继续执行
              </button>
            ) : null}
            {task.phase === "canceled_link_failed" ? (
              <button type="button" onClick={() => void retryPaymentLink()}>
                重试生成短链
              </button>
            ) : null}
            {task.canRecover ? (
              <button type="button" onClick={() => void recoverOrder()}>
                核对订单结果
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {connectionLost ? (
        <button className="agent-test__reconnect" type="button" onClick={() => void refreshTask()}>
          重新连接并查询当前任务
        </button>
      ) : null}
      <textarea
        ref={inputRef}
        value={query}
        maxLength={1000}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send(query);
          }
        }}
        placeholder={task?.dialogue?.pendingSlot?.question || "描述购物需求，或补充当前条件…"}
        rows={2}
        disabled={!canSend}
        aria-label="发送消息"
      />
      <div className="agent-test__composer-footer">
        <span>Enter 发送 · Shift + Enter 换行</span>
        <button type="submit" disabled={!canSend || !query.trim()} aria-label="发送">
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  );
}
