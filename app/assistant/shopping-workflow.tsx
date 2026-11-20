import { Bot, CircleAlert } from "lucide-react";
import {
  SHOPPING_PHASE_LABELS,
  type ShoppingMode,
  type ShoppingPhase,
} from "@/lib/agent/shopping-task-types";

export function ShoppingWorkflow({ mode, phase }: { mode: ShoppingMode; phase?: ShoppingPhase }) {
  return (
    <aside className="agent-test__details" aria-label="流程说明">
      <div className="agent-test__detail-heading">
        <span className="agent-test__detail-icon">
          <Bot size={18} />
        </span>
        <div>
          <strong>购物流程</strong>
          <small>{mode === "auto" ? "自动下单模式" : "确认后下单模式"}</small>
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
            <strong>生成支付金额</strong>
            <small>重新校验库存与购物车金额</small>
          </div>
        </li>
        <li>
          <span>04</span>
          <div>
            <strong>{mode === "auto" ? "自动创建订单" : "确认订单"}</strong>
            <small>
              {mode === "auto"
                ? "报价展示约 3 秒后自动提交，开始创建后不可取消"
                : "仅在你明确确认后提交"}
            </small>
          </div>
        </li>
      </ol>
      {phase ? (
        <p className="agent-test__phase" role="status">
          当前阶段：{SHOPPING_PHASE_LABELS[phase]}
        </p>
      ) : null}
    </aside>
  );
}
