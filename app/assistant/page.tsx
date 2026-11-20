"use client";

import { RotateCcw } from "lucide-react";
import { AssistantComposer } from "./assistant-composer";
import { AssistantMessages } from "./assistant-messages";
import { ShoppingWorkflow } from "./shopping-workflow";
import { useAssistant } from "./use-assistant";
import "./assistant.css";

export default function AssistantTestPage() {
  const assistant = useAssistant();
  const { messages, busy, error, mode, setMode, task, send, copyShortLink, reset } = assistant;

  return (
    <section className="agent-test" aria-label="AI 助手测试">
      <header className="agent-test__heading">
        <div className="agent-test__identity">
          <p className="eyebrow">SHOPPING AGENT</p>
          <span className="agent-test__online">
            <span className="agent-test__online-text">AI助手</span><i />在线
          </span>
        </div>
        <div className="agent-test__mode-bar">
          <fieldset className="agent-test__modes" disabled={busy}>
            <legend className="agent-test__mode-legend">交互模式</legend>
            <label>
              <input
                type="radio"
                name="shopping-mode"
                value="manual"
                checked={mode === "manual"}
                onChange={() => setMode("manual")}
              />
              确认后下单
            </label>
            <label>
              <input
                type="radio"
                name="shopping-mode"
                value="auto"
                checked={mode === "auto"}
                onChange={() => setMode("auto")}
              />
              自动下单
            </label>
          </fieldset>
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
          />
          {messages.length === 1 && !busy ? (
            <div className="agent-test__suggestions">
              <span>试试这样问</span>
              {["推荐一款咖啡", "找一个价格合适的蓝牙耳机", "我想买厨房用品"].map((item) => (
                <button key={item} type="button" onClick={() => void send(item)}>
                  {item}
                </button>
              ))}
            </div>
          ) : null}
          <AssistantComposer controller={assistant} />
        </section>

        <ShoppingWorkflow mode={mode} phase={task?.phase} />
      </div>
    </section>
  );
}
