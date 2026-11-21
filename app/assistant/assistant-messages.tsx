"use client";

import Link from "next/link";
import {
  Bot,
  Check,
  CircleAlert,
  Copy,
  Link2,
  LoaderCircle,
  UserRound,
} from "lucide-react";
import type { AssistantController } from "./use-assistant";
import { AssistantProductCard } from "./assistant-product-card";
import { formatMoney } from "./format";
import { AssistantReviewAnalysis } from "./assistant-review-analysis";
import { differenceActual, differenceHint } from "./difference-hint";

type AssistantMessagesProps = Pick<
  AssistantController,
  "messages" | "busy" | "error" | "copyShortLink" | "send" | "canSend" | "task"
>;

export function AssistantMessages({
  messages,
  busy,
  error,
  copyShortLink,
  send,
  canSend,
  task,
}: AssistantMessagesProps) {
  return (
    <div className="agent-test__messages" aria-live="polite">
      {messages.map((message, index) => (
        <article
          className={`agent-message agent-message--${message.role}`}
          key={`${index}-${message.role}`}
        >
          <span className="agent-message__avatar">
            {message.role === "assistant" ? (
              <Bot size={17} />
            ) : (
              <UserRound size={16} />
            )}
          </span>
          <div className="agent-message__content">
            <span className="agent-message__name">
              {message.role === "assistant" ? "购物助手" : "你"}
            </span>
            <p>{message.text}</p>
            {message.reviewAnalysis ? (
              <AssistantReviewAnalysis
                report={message.reviewAnalysis}
                onAsk={(query) => void send(query)}
                disabled={
                  !canSend ||
                  task?.product?.id !== message.reviewAnalysis.productId
                }
              />
            ) : null}
            {message.result?.product ? (
              <AssistantProductCard product={message.result.product} />
            ) : null}
            {message.result?.differences?.length ? (
              <div className="agent-message__differences">
                <strong>
                  {message.result.status === "ordered"
                    ? "已确认接受的商品差异"
                    : message.result.status === "failed"
                      ? "本次商品差异"
                    : "请确认以下商品差异"}
                </strong>
                <ul>
                  {message.result.differences.map((difference, i) => (
                    <li key={i}>
                      <span>
                        要求：{difference.requirement}
                        {differenceActual(difference)
                          ? `；实际：${differenceActual(difference)}`
                          : message.result?.status === "ordered"
                            ? "；确认时尚无法核实是否符合该要求"
                            : null}
                      </span>
                      {message.result?.status !== "ordered" && message.result?.status !== "failed" ? (
                        <p>{differenceHint(difference)}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {message.result?.quote?.quote ? (
              <div className="agent-message__quote">
                <span>支付总额</span>
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
                    商品{" "}
                    {formatMoney(
                      (message.result.quote.quote.subtotalMinor ?? 0) / 100,
                      message.result.quote.quote.currency,
                    )}
                    {" · "}优惠{" "}
                    {formatMoney(
                      (message.result.quote.quote.discountMinor ?? 0) / 100,
                      message.result.quote.quote.currency,
                    )}
                    {" · "}运费{" "}
                    {formatMoney(
                      (message.result.quote.quote.shippingMinor ?? 0) / 100,
                      message.result.quote.quote.currency,
                    )}
                    {" · "}数量 {message.result.quantity ?? 1}
                  </small>
                ) : null}
              </div>
            ) : null}
            {message.result?.status === "ordered" ? (
              <div className="agent-message__success">
                <Check size={15} />
                <span>
                  订单已提交
                  <small>
                    订单编号：{message.result.order?.orderGroupId || "已生成"}
                  </small>
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
          {error.includes("授权") ? (
            <Link href="/orders">前往完成授权</Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
