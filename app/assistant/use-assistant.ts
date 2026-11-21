"use client";

/**
 * AI 购物助手的客户端状态管理 Hook。
 *
 * 负责：登录态感知、消息流、购物任务的恢复/轮询/自动推进、
 * 发送消息、确认下单/取消、短链复制等交互，并处理异步竞态与登录切换。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth";
import {
  SHOPPING_PHASE_LABELS,
  type ShoppingMode,
  type ShoppingTask,
} from "@/lib/shop-task/shopping-task-types";
import {
  sendAssistantMessageRequest,
  getActiveShoppingTaskRequest,
  getShoppingTaskRequest,
  shoppingTaskActionRequest,
} from "./api";
import type { ChatMessage } from "./types";

// 会话初始消息：始终显示一条助手欢迎语。
const INITIAL: ChatMessage[] = [
  {
    role: "assistant",
    text: "你好，我是AI购物助手。告诉我想买什么，你可以选择确认后下单或自动下单。",
  },
];

export function useAssistant() {
  const { user, loading } = useAuth();
  const userid = user?.userid;
  // ownerRef：保存当前登录用户，供异步回调判断「用户是否已切换」，避免结果串到别人界面。
  const ownerRef = useRef(userid);
  ownerRef.current = userid;
  // 界面状态：消息流、购物模式、输入框、当前任务与各类进行中标志。
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL);
  const [mode, setMode] = useState<ShoppingMode>("manual");
  const [query, setQuery] = useState("");
  const [task, setTask] = useState<ShoppingTask | null>(null);
  const taskRef = useRef<ShoppingTask | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [restoring, setRestoring] = useState(false);
  const [paused, setPaused] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [error, setError] = useState("");
  // advanceTick：自动推进完成后 +1，用于重新触发自动推进 effect 的评估。
  const [advanceTick, setAdvanceTick] = useState(0);
  const advancing = useRef(false);
  // creation：创建任务的幂等键；同一 query+mode 复用同一 key，query/mode 变化才重新生成。
  const creation = useRef<{ query: string; mode: ShoppingMode; key: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // busy：加载中、发送中、恢复中，或存在未终态任务时视为忙碌。
  const busy = loading || starting || restoring || !!(task && !task.terminal);
  // canSend：仅在所有交互都空闲且未断连时允许发送。
  const canSend =
    !loading && !starting && !restoring && !submitting && !canceling && !connectionLost;

  // acceptTask：接收最新任务视图，做 revision 防倒退，并同步到消息流与本地缓存。
  const acceptTask = useCallback((next: ShoppingTask) => {
    const previous = taskRef.current;
    // 同一任务里，旧 revision 的响应不回退覆盖新状态。
    if (previous?.taskId === next.taskId && previous.revision > next.revision) return;
    taskRef.current = next;
    setTask(next);
    setMode(next.mode);
    const message: ChatMessage = {
      taskId: next.taskId,
      role: "assistant",
      text: next.clarification || next.error || SHOPPING_PHASE_LABELS[next.phase],
      result: {
        status:
          next.phase === "ordered" ? "ordered" : next.quote ? "ready_for_confirmation" : undefined,
        product: next.product,
        quantity: next.quantity ?? 1,
        quote: next.quote,
        order: next.order,
      },
      shortLink: next.link
        ? `${window.location.origin}/handoff?token=${encodeURIComponent(next.link.urlToken)}`
        : undefined,
    };
    // 同一 taskId 的消息做原地替换，避免重复堆叠。
    setMessages((items) => {
      const index = items.findIndex((item) => item.taskId === next.taskId);
      if (index < 0) return [...items, message];
      return items.map((item, position) => (position === index ? message : item));
    });
    // 缓存 taskId，便于刷新页面后恢复未完成任务。
    if (ownerRef.current) {
      try {
        sessionStorage.setItem(`assistant-task:${ownerRef.current}`, next.taskId);
      } catch {
        /* 浏览器可能禁用存储。 */
      }
    }
  }, []);

  // 登录态变化时恢复任务：优先取活动任务，其次取 sessionStorage 里缓存的任务。
  useEffect(() => {
    if (loading) return;
    // 发起请求触发登录时，由原请求恢复；不要再用恢复任务的请求覆盖新任务。
    if (startingRef.current) return;
    let disposed = false;
    taskRef.current = null;
    setTask(null);
    setMessages(INITIAL);
    setError("");
    setConnectionLost(false);
    setPaused(false);
    creation.current = null;
    if (!userid) {
      setRestoring(false);
      return;
    }
    setRestoring(true);
    void (async () => {
      const active = await getActiveShoppingTaskRequest();
      if (disposed) return;
      if (!active.success) {
        setError(active.errorMsg);
        return;
      }
      let restored = active.data.task;
      if (!restored) {
        let stored: string | null = null;
        try {
          stored = sessionStorage.getItem(`assistant-task:${userid}`);
        } catch {
          /* 无存储时仅恢复活动任务。 */
        }
        if (stored) {
          const result = await getShoppingTaskRequest(stored);
          if (disposed) return;
          if (result.success) restored = result.data.task;
        }
      }
      if (restored) {
        setMessages([...INITIAL, { role: "user", text: restored.query }]);
        // 恢复后：非终态且不在「等待用户确认/提交中」等阶段时，暂停自动推进，避免意外下单。
        setPaused(
          !restored.terminal &&
            ![
              "awaiting_confirmation",
              "committing",
              "reconciling_result",
              "cancel_pending",
              "link_creating",
            ].includes(restored.phase)
        );
        acceptTask(restored);
        if (restored.reviewAnalysis)
          setMessages((items) => [
            ...items,
            {
              role: "assistant",
              text: "已恢复当前商品最近一次评论分析。",
              reviewAnalysis: restored.reviewAnalysis,
            },
          ]);
      }
    })().finally(() => {
      if (!disposed) setRestoring(false);
    });
    return () => {
      disposed = true;
    };
  }, [userid, loading, acceptTask]);

  // refreshTask：手动拉取最新任务视图，失败则标记断连（不据此判定订单失败）。
  const refreshTask = useCallback(async () => {
    const current = taskRef.current;
    const owner = ownerRef.current;
    if (!current) return;
    const result = await getShoppingTaskRequest(current.taskId);
    // 请求返回期间用户或任务已切换，则丢弃本次结果。
    if (owner !== ownerRef.current || taskRef.current?.taskId !== current.taskId) return;
    if (result.success) {
      acceptTask(result.data.task);
      setError("");
      setConnectionLost(false);
    } else {
      setConnectionLost(true);
      setError("进度暂时无法获取，请点击重新连接；不会据此判定订单失败。");
    }
  }, [acceptTask]);

  // 非终态任务每 800ms 轮询一次，直到进入终态、断连或组件卸载。
  const pollingTaskId = task?.taskId;
  const pollingTerminal = task?.terminal;
  useEffect(() => {
    if (!pollingTaskId || pollingTerminal || connectionLost) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await getShoppingTaskRequest(pollingTaskId);
      if (disposed) return;
      if (result.success) {
        acceptTask(result.data.task);
        if (!result.data.task.terminal) timer = setTimeout(poll, 800);
      } else {
        setConnectionLost(true);
        setError("进度暂时无法获取，请点击重新连接；不会据此判定订单失败。");
      }
    };
    timer = setTimeout(poll, 800);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [pollingTaskId, pollingTerminal, connectionLost, acceptTask]);

  // act：统一执行任务动作（推进/取消/确认/重试短链/恢复下单），并做竞态守卫。
  const act = useCallback(
    async (
      action: "advance" | "cancel" | "confirm" | "retry-link" | "recover" | "resume-after-reviews"
    ) => {
      const current = taskRef.current;
      const owner = ownerRef.current;
      if (!current) return;
      const quote = current.quote?.quote;
      const result = await shoppingTaskActionRequest(
        current.taskId,
        action,
        // 仅确认下单需要带上当前报价，服务端会据此校验报价未过期。
        action === "confirm" && quote
          ? { cartVersion: quote.cartVersion, quoteId: quote.quoteId }
          : undefined
      );
      // 返回期间用户或任务已切换，丢弃结果。
      if (owner !== ownerRef.current || taskRef.current?.taskId !== current.taskId) return;
      if (result.success) {
        acceptTask(result.data.task);
        if (action === "resume-after-reviews" && !result.data.task.reviewHold) setPaused(false);
        setError("");
      } else {
        setError(result.errorMsg);
        await refreshTask();
      }
    },
    [acceptTask, refreshTask]
  );

  // 自动推进：任务可推进且未暂停时，延迟触发 advance；ready_to_order 时按 commitAfter 等待。
  useEffect(() => {
    if (!task?.canAdvance || paused || starting || canceling || connectionLost || advancing.current)
      return;
    const delay =
      task.phase === "ready_to_order" && task.commitAfter
        ? Math.max(300, Date.parse(task.commitAfter) - Date.now())
        : 0;
    const timer = setTimeout(() => {
      if (startingRef.current) return;
      advancing.current = true;
      const committing = task.phase === "ready_to_order";
      if (committing) setSubmitting(true);
      void act("advance").finally(() => {
        advancing.current = false;
        setSubmitting(false);
        setAdvanceTick((value) => value + 1);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [task, paused, starting, canceling, connectionLost, advanceTick, act]);

  // send：发送一条用户消息；处理超长、重复、登录切换等竞态。
  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || !canSend || startingRef.current || prompt.length > 1000) return;
    const initiatingUser = ownerRef.current;
    setStarting(true);
    startingRef.current = true;
    setError("");
    // 同一 query+mode 复用幂等键，避免重试产生重复任务。
    if (creation.current?.query !== prompt || creation.current.mode !== mode)
      creation.current = { query: prompt, mode, key: crypto.randomUUID() };
    const result = await sendAssistantMessageRequest(prompt, mode, creation.current.key, task);
    // 请求期间用户已切换（重新登录），丢弃本次结果。
    if (initiatingUser && initiatingUser !== ownerRef.current) {
      setStarting(false);
      startingRef.current = false;
      return;
    }
    if (result.success) {
      setMessages((items) => [...items, { role: "user", text: prompt }]);
      setQuery("");
      // 恢复中的任务被 resumeTask 继续推进；否则新任务默认暂停等待确认。
      if (result.data.pauseTask) setPaused(true);
      else if (result.data.resumeTask) setPaused(false);
      else if (result.data.task && result.data.task.taskId !== taskRef.current?.taskId)
        setPaused(true);
      setConnectionLost(false);
      if (result.data.task) acceptTask(result.data.task);
      if (result.data.reply || result.data.reviewAnalysis)
        setMessages((items) => [
          ...items,
          {
            role: "assistant",
            text: result.data.reply || "当前商品评论分析",
            reviewAnalysis: result.data.reviewAnalysis,
          },
        ]);
      creation.current = null;
    } else {
      setError(result.errorMsg);
      // 发送失败时尝试拉回活动任务，避免本地状态与服务端脱节。
      if (ownerRef.current) {
        const active = await getActiveShoppingTaskRequest();
        if (active.success && active.data.task) {
          setPaused(true);
          acceptTask(active.data.task);
        }
      }
    }
    setStarting(false);
    startingRef.current = false;
    inputRef.current?.focus();
  }

  // 取消任务并回到可重新发起支付链接的状态。
  async function cancelToPaymentLink() {
    if (!taskRef.current?.canCancel || canceling || submitting) return;
    setCanceling(true);
    setPaused(false);
    try {
      await act("cancel");
    } finally {
      setCanceling(false);
    }
  }

  // 确认下单。
  async function confirmOrder() {
    if (!taskRef.current?.canConfirm || submitting) return;
    setSubmitting(true);
    try {
      await act("confirm");
    } finally {
      setSubmitting(false);
    }
  }

  // 复制短链到剪贴板。
  async function copyShortLink(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setError("");
    } catch {
      setError("复制失败，请打开短链后从地址栏复制。");
    }
  }

  // 清空会话与本地缓存的任务。
  function reset() {
    if (busy) return;
    setMessages(INITIAL);
    setTask(null);
    taskRef.current = null;
    setError("");
    setQuery("");
    creation.current = null;
    if (userid) {
      try {
        sessionStorage.removeItem(`assistant-task:${userid}`);
      } catch {
        /* 可选存储。 */
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(query);
  }

  return {
    messages,
    query,
    setQuery,
    busy,
    canSend,
    error,
    inputRef,
    mode,
    setMode,
    task,
    paused,
    canceling,
    submitting,
    connectionLost,
    send,
    confirmOrder,
    cancelToPaymentLink,
    copyShortLink,
    submit,
    reset,
    refreshTask,
    resume: () => setPaused(false),
    retryPaymentLink: () => act("retry-link"),
    recoverOrder: () => act("recover"),
    resumeAfterReviews: () => act("resume-after-reviews"),
  };
}

export type AssistantController = ReturnType<typeof useAssistant>;
