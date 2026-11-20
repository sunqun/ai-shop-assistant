"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth";
import {
  SHOPPING_PHASE_LABELS,
  type ShoppingMode,
  type ShoppingTask,
} from "@/lib/shop-task/shopping-task-types";
import {
  createShoppingTaskRequest,
  getActiveShoppingTaskRequest,
  getShoppingTaskRequest,
  shoppingTaskActionRequest,
} from "./api";
import type { ChatMessage } from "./types";

const INITIAL: ChatMessage[] = [
  {
    role: "assistant",
    text: "你好，我是AI购物助手。告诉我想买什么，你可以选择确认后下单或自动下单。",
  },
];

export function useAssistant() {
  const { user, loading } = useAuth();
  const userid = user?.userid;
  const ownerRef = useRef(userid);
  ownerRef.current = userid;
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
  const [advanceTick, setAdvanceTick] = useState(0);
  const advancing = useRef(false);
  const creation = useRef<{ query: string; mode: ShoppingMode; key: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = loading || starting || restoring || !!(task && !task.terminal);

  const acceptTask = useCallback((next: ShoppingTask) => {
    const previous = taskRef.current;
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
        quote: next.quote,
        order: next.order,
      },
      shortLink: next.link
        ? `${window.location.origin}/handoff?token=${encodeURIComponent(next.link.urlToken)}`
        : undefined,
    };
    setMessages((items) => {
      const index = items.findIndex((item) => item.taskId === next.taskId);
      if (index < 0) return [...items, message];
      return items.map((item, position) => (position === index ? message : item));
    });
    if (ownerRef.current) {
      try {
        sessionStorage.setItem(`assistant-task:${ownerRef.current}`, next.taskId);
      } catch {
        /* 浏览器可能禁用存储。 */
      }
    }
  }, []);

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
      }
    })().finally(() => {
      if (!disposed) setRestoring(false);
    });
    return () => {
      disposed = true;
    };
  }, [userid, loading, acceptTask]);

  const refreshTask = useCallback(async () => {
    const current = taskRef.current;
    const owner = ownerRef.current;
    if (!current) return;
    const result = await getShoppingTaskRequest(current.taskId);
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

  const act = useCallback(
    async (action: "advance" | "cancel" | "confirm" | "retry-link" | "recover") => {
      const current = taskRef.current;
      const owner = ownerRef.current;
      if (!current) return;
      const quote = current.quote?.quote;
      const result = await shoppingTaskActionRequest(
        current.taskId,
        action,
        action === "confirm" && quote
          ? { cartVersion: quote.cartVersion, quoteId: quote.quoteId }
          : undefined
      );
      if (owner !== ownerRef.current || taskRef.current?.taskId !== current.taskId) return;
      if (result.success) {
        acceptTask(result.data.task);
        setError("");
      } else {
        setError(result.errorMsg);
        await refreshTask();
      }
    },
    [acceptTask, refreshTask]
  );

  useEffect(() => {
    if (!task?.canAdvance || paused || canceling || connectionLost || advancing.current) return;
    const delay =
      task.phase === "ready_to_order" && task.commitAfter
        ? Math.max(300, Date.parse(task.commitAfter) - Date.now())
        : 0;
    const timer = setTimeout(() => {
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
  }, [task, paused, canceling, connectionLost, advanceTick, act]);

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || busy || startingRef.current || prompt.length > 1000) return;
    const initiatingUser = ownerRef.current;
    setStarting(true);
    startingRef.current = true;
    setError("");
    if (creation.current?.query !== prompt || creation.current.mode !== mode)
      creation.current = { query: prompt, mode, key: crypto.randomUUID() };
    const result = await createShoppingTaskRequest(prompt, mode, creation.current.key);
    if (initiatingUser && initiatingUser !== ownerRef.current) {
      setStarting(false);
      startingRef.current = false;
      return;
    }
    if (result.success) {
      setMessages((items) => [...items, { role: "user", text: prompt }]);
      setQuery("");
      setPaused(false);
      setConnectionLost(false);
      acceptTask(result.data.task);
      creation.current = null;
    } else {
      setError(result.errorMsg);
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

  async function confirmOrder() {
    if (!taskRef.current?.canConfirm || submitting) return;
    setSubmitting(true);
    try {
      await act("confirm");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyShortLink(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setError("");
    } catch {
      setError("复制失败，请打开短链后从地址栏复制。");
    }
  }

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
  };
}

export type AssistantController = ReturnType<typeof useAssistant>;
