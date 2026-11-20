"use client";

import { ArrowUp, Check, X } from "lucide-react";
import type { AssistantController } from "./use-assistant";

type AssistantComposerProps = Pick<
  AssistantController,
  | "query"
  | "setQuery"
  | "busy"
  | "pendingConfirmation"
  | "inputRef"
  | "send"
  | "confirmOrder"
  | "cancelToPaymentLink"
  | "submit"
>;

export function AssistantComposer({
  query,
  setQuery,
  busy,
  pendingConfirmation,
  inputRef,
  send,
  confirmOrder,
  cancelToPaymentLink,
  submit,
}: AssistantComposerProps) {
  return (
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
  );
}
