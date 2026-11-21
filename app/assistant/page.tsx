"use client";

import { RotateCcw } from "lucide-react";
import { AssistantComposer } from "./assistant-composer";
import { AssistantMessages } from "./assistant-messages";
import { ShoppingWorkflow } from "./shopping-workflow";
import { useAssistant } from "./use-assistant";
import "./assistant.css";

export default function AssistantTestPage() {
  const assistant = useAssistant();
  const { messages, busy, error, task, send, copyShortLink, reset } = assistant;

  return (
    <section className="agent-test" aria-label="AI 助手测试">
      <header className="agent-test__heading">
        <div className="agent-test__identity">
          <p className="eyebrow">SHOPPING AGENT</p>
          <span className="agent-test__online">
            <span className="agent-test__online-text">AI助手</span>
            <i />
            在线
          </span>
        </div>
        <div className="agent-test__header-actions">
          <div className="agent-test__heading-actions">
            <button
              className="agent-test__icon-button"
              type="button"
              onClick={reset}
              disabled={busy}
              title="重新开始"
              aria-label="重新开始"
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>
      </header>

      <div className="agent-test__workspace">
        <section className="agent-test__conversation" aria-label="对话">
          <AssistantMessages
            messages={messages}
            busy={busy && !task?.canConfirm && !assistant.paused && !task?.canRecover}
            error={error}
            copyShortLink={copyShortLink}
            send={send}
            canSend={assistant.canSend}
            task={task}
          />
          {messages.length === 1 && !busy ? (
            <div className="agent-test__suggestions">
              <span>试试这样问</span>
              {["推荐一款咖啡", "找一个价格合适的蓝牙耳机"].map((item) => (
                <button key={item} type="button" onClick={() => void send(item)}>
                  {item}
                </button>
              ))}
            </div>
          ) : null}
          <AssistantComposer controller={assistant} />
        </section>

        <ShoppingWorkflow phase={task?.phase} />
      </div>
    </section>
  );
}
