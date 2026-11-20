"use client";

import { RotateCcw } from "lucide-react";
import { AssistantComposer } from "./assistant-composer";
import { AssistantMessages } from "./assistant-messages";
import { ShoppingWorkflow } from "./shopping-workflow";
import { useAssistant } from "./use-assistant";
import "./assistant.css";

export default function AssistantTestPage() {
  const {
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
  } = useAssistant();

  return (
    <section className="agent-test" aria-label="AI 助手测试">
      <header className="agent-test__heading">
        <div>
          <p className="eyebrow">SHOPPING AGENT</p>
          <h1>AI 助手</h1>
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
          <AssistantMessages
            messages={messages}
            busy={busy}
            error={error}
            copyShortLink={copyShortLink}
          />
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
          <AssistantComposer
            query={query}
            setQuery={setQuery}
            busy={busy}
            pendingConfirmation={pendingConfirmation}
            inputRef={inputRef}
            send={send}
            confirmOrder={confirmOrder}
            cancelToPaymentLink={cancelToPaymentLink}
            submit={submit}
          />
        </section>

        <ShoppingWorkflow />
      </div>
    </section>
  );
}
