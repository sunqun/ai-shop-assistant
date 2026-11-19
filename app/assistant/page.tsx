"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Bot,
  Check,
  CircleAlert,
  Copy,
  Link2,
  LoaderCircle,
  RotateCcw,
  ShoppingBag,
  UserRound,
  X,
} from "lucide-react";
import "./assistant.css";

type AssistantResult = {
  status?: "ready_for_confirmation" | "ordered" | "needs_login" | "needs_authorization" | "failed";
  message?: string;
  product?: { id?: string; name?: string; price?: number; stock?: number };
  quote?: {
    quote?: {
      quoteId: string;
      cartVersion: number;
      currency: string;
      totalDueMinor: number;
      expiresAt: string;
    };
  };
  order?: { orderGroupId?: string; orders?: Array<{ orderId: string }> };
};
type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  result?: AssistantResult;
  shortLink?: string;
};
type Confirmation = { cartVersion: number; quoteId: string };

function formatMoney(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : "待核价";
}

export default function AssistantTestPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "你好，我是 AI 购物助手。告诉我你想买什么，我会检索在售商品、挑选低价商品并生成报价。",
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
      const response = await fetch("/api/v1/assistant/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: prompt }),
      });
      const data = (await response.json()) as AssistantResult & { message?: string; code?: string };
      if (!response.ok) {
        if (response.status === 401) throw new Error("请先登录商城账号，再测试购物流程。");
        throw new Error(data.message || "助手暂时无法响应，请稍后重试。");
      }
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
      const response = await fetch("/api/v1/assistant/react/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...confirmation,
          idempotencyKey:
            confirmationKeyRef.current ?? (confirmationKeyRef.current = crypto.randomUUID()),
        }),
      });
      const data = (await response.json()) as AssistantResult & { message?: string };
      if (!response.ok) throw new Error(data.message || "订单暂时无法提交，请重新获取报价。");
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
      const response = await fetch("/api/v1/assistant/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: 1 }),
      });
      const data = (await response.json()) as { link?: { urlToken?: string }; message?: string };
      if (!response.ok || !data.link?.urlToken)
        throw new Error(data.message || "短链暂时无法生成，请稍后重试。");
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
        text: "你好，我是 AI 购物助手。告诉我你想买什么，我会检索在售商品、挑选低价商品并生成报价。",
      },
    ]);
    setError("");
    setPendingConfirmation(false);
    setConfirmation(null);
    confirmationKeyRef.current = null;
    setQuery("");
  }

  return (
    <section className="agent-test" aria-label="AI 助手测试">
      <header className="agent-test__heading">
        <div>
          <p className="eyebrow">SHOPPING AGENT</p>
          <h1>AI 助手</h1>
          <p>连接真实商品目录与购物流程</p>
        </div>
        <div className="agent-test__heading-actions">
          <span className="agent-test__online">
            <i />
            在线
          </span>
          <button
            className="agent-test__icon-button"
            type="button"
            onClick={reset}
            title="重新开始"
            aria-label="重新开始"
          >
            <RotateCcw size={17} />
          </button>
        </div>
      </header>

      <div className="agent-test__workspace">
        <section className="agent-test__conversation" aria-label="对话">
          <div className="agent-test__messages" aria-live="polite">
            {messages.map((message, index) => (
              <article
                className={`agent-message agent-message--${message.role}`}
                key={`${index}-${message.role}`}
              >
                <span className="agent-message__avatar">
                  {message.role === "assistant" ? <Bot size={17} /> : <UserRound size={16} />}
                </span>
                <div className="agent-message__content">
                  <span className="agent-message__name">
                    {message.role === "assistant" ? "购物助手" : "你"}
                  </span>
                  <p>{message.text}</p>
                  {message.result?.product ? (
                    <div className="agent-product">
                      <ShoppingBag size={16} />
                      <span>
                        {message.result.product.name || "已选商品"}
                        <small>库存 {message.result.product.stock ?? "—"}</small>
                      </span>
                      <strong>{formatMoney(message.result.product.price)}</strong>
                    </div>
                  ) : null}
                  {message.result?.status === "ready_for_confirmation" ? (
                    <div className="agent-message__quote">
                      <span>报价总额</span>
                      <strong>
                        {message.result.quote?.quote
                          ? new Intl.NumberFormat("zh-TW", {
                              style: "currency",
                              currency: message.result.quote.quote.currency,
                            }).format(message.result.quote.quote.totalDueMinor / 100)
                          : "报价已生成"}
                      </strong>
                      {message.result.quote?.quote ? (
                        <small>
                          有效至{" "}
                          {new Date(message.result.quote.quote.expiresAt).toLocaleString("zh-TW")}
                        </small>
                      ) : null}
                    </div>
                  ) : null}
                  {message.result?.status === "ordered" ? (
                    <div className="agent-message__success">
                      <Check size={15} />
                      <span>
                        订单已提交
                        <small>订单编号：{message.result.order?.orderGroupId || "已生成"}</small>
                      </span>
                    </div>
                  ) : null}
                  {message.shortLink ? (
                    <div className="agent-test__short-link">
                      <Link2 size={15} />
                      <a href={message.shortLink} target="_blank" rel="noreferrer">
                        {message.shortLink}
                      </a>
                      <button
                        type="button"
                        onClick={() => void copyShortLink(message.shortLink!)}
                        title="复制短链"
                        aria-label="复制短链"
                      >
                        <Copy size={15} />
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
            {busy ? (
              <div className="agent-test__working">
                <LoaderCircle size={16} />
                助手正在处理…
              </div>
            ) : null}
            {error ? (
              <div className="agent-test__error" role="alert">
                <CircleAlert size={16} />
                <span>{error}</span>
                {error.includes("登录") ? <Link href="/login">前往登录</Link> : null}
              </div>
            ) : null}
          </div>
          {messages.length === 1 ? (
            <div className="agent-test__suggestions">
              <span>试试这样问</span>
              {["推荐一款咖啡", "找一个价格合适的蓝牙耳机", "我想买厨房用品"].map((item) => (
                <button key={item} type="button" onClick={() => void send(item)}>
                  {item}
                </button>
              ))}
            </div>
          ) : null}
          <form className="agent-test__composer" onSubmit={submit}>
            {pendingConfirmation ? (
              <div className="agent-test__confirm">
                <span>选择直接下单或改用支付短链</span>
                <div className="agent-test__confirm-actions">
                  <button
                    className="agent-test__cancel"
                    type="button"
                    disabled={busy}
                    onClick={() => void cancelToPaymentLink()}
                  >
                    <X size={15} />
                    取消
                  </button>
                  <button type="button" disabled={busy} onClick={() => void confirmOrder()}>
                    <Check size={15} />
                    确认下单
                  </button>
                </div>
              </div>
            ) : null}
            <textarea
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(query);
                }
              }}
              placeholder="描述你想购买的商品…"
              rows={2}
              disabled={busy}
              aria-label="发送消息"
            />
            <div className="agent-test__composer-footer">
              <span>Enter 发送 · Shift + Enter 换行</span>
              <button type="submit" disabled={busy || !query.trim()} aria-label="发送">
                <ArrowUp size={18} />
              </button>
            </div>
          </form>
        </section>

        <aside className="agent-test__details" aria-label="流程说明">
          <div className="agent-test__detail-heading">
            <span className="agent-test__detail-icon">
              <Bot size={18} />
            </span>
            <div>
              <strong>购物流程</strong>
              <small>Shopping ReAct</small>
            </div>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>搜索商品</strong>
                <small>匹配真实商品目录与库存</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>选择商品</strong>
                <small>优先选择目录排序靠前的有货商品</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>生成报价</strong>
                <small>重新校验库存与购物车金额</small>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <strong>确认订单</strong>
                <small>仅在你明确确认后提交</small>
              </div>
            </li>
          </ol>
          <div className="agent-test__detail-note">
            <CircleAlert size={15} />
            <span>订单提交会写入商城账号。未登录时请先登录。</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
