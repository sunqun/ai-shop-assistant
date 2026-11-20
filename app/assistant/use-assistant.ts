"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  confirmAssistantOrderRequest,
  createAssistantPaymentLinkRequest,
  sendAssistantRequest,
} from "./api";
import type { ChatMessage, Confirmation } from "./types";

const INITIAL_GREETING =
  "你好，我是 AI 购物助手。告诉我你想买什么，我会检索在售商品、挑选低价商品并生成报价。";

export function useAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: INITIAL_GREETING,
    },
  ]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmationKeyRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    setMessages((items) => [...items, { role: "user", text: prompt }]);
    setQuery("");
    try {
      const result = await sendAssistantRequest(prompt);
      if (!result.success) throw new Error(result.errorMsg);
      const data = result.data;
      setMessages((items) => [
        ...items,
        { role: "assistant", text: data.message || "流程已完成。", result: data },
      ]);
      setPendingConfirmation(data.status === "ready_for_confirmation");
      if (data.status === "ready_for_confirmation" && data.quote?.quote) {
        setConfirmation({
          cartVersion: data.quote.quote.cartVersion,
          quoteId: data.quote.quote.quoteId,
        });
        confirmationKeyRef.current = null;
      } else {
        setConfirmation(null);
        confirmationKeyRef.current = null;
      }
    } catch (cause) {
      setPendingConfirmation(false);
      setError(cause instanceof Error ? cause.message : "网络连接失败，请稍后重试。");
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  async function confirmOrder() {
    if (!confirmation || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await confirmAssistantOrderRequest({
        ...confirmation,
        idempotencyKey:
          confirmationKeyRef.current ?? (confirmationKeyRef.current = crypto.randomUUID()),
      });
      if (!result.success) throw new Error(result.errorMsg);
      const data = result.data;
      setMessages((items) => [
        ...items,
        { role: "assistant", text: data.message || "订单已提交。", result: data },
      ]);
      setPendingConfirmation(false);
      setConfirmation(null);
      confirmationKeyRef.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "订单提交失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function cancelToPaymentLink() {
    const productId = messages.toReversed().find((message) => message.result?.product?.id)?.result
      ?.product?.id;
    if (!productId || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await createAssistantPaymentLinkRequest(productId);
      if (!result.success) throw new Error(result.errorMsg);
      const data = result.data;
      if (!data.link?.urlToken) throw new Error(data.message || "短链暂时无法生成，请稍后重试。");
      const shortLink = `${window.location.origin}/handoff?token=${encodeURIComponent(data.link.urlToken)}`;
      setMessages((items) => [
        ...items,
        { role: "assistant", text: "已取消直接下单，为你生成了支付短链。", shortLink },
      ]);
      setPendingConfirmation(false);
      setConfirmation(null);
      confirmationKeyRef.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "短链暂时无法生成，请稍后重试。");
    } finally {
      setBusy(false);
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(query);
  }

  function reset() {
    setMessages([
      {
        role: "assistant",
        text: INITIAL_GREETING,
      },
    ]);
    setError("");
    setPendingConfirmation(false);
    setConfirmation(null);
    confirmationKeyRef.current = null;
    setQuery("");
  }

  return {
    messages,
    query,
    setQuery,
    busy,
    pendingConfirmation,
    error,
    inputRef,
    send,
    confirmOrder,
    cancelToPaymentLink,
    copyShortLink,
    submit,
    reset,
  };
}

export type AssistantController = ReturnType<typeof useAssistant>;
