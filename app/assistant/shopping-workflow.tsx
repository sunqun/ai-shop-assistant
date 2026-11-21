import { Bot } from "lucide-react";
import {
  SHOPPING_PHASE_LABELS,
  type ShoppingPhase,
} from "@/lib/shop-task/shopping-task-types";

export function ShoppingWorkflow({ phase }: { phase?: ShoppingPhase }) {
  return (
    <aside className="agent-test__details" aria-label="流程说明">
      <div className="agent-test__detail-heading">
        <span className="agent-test__detail-icon">
          <Bot size={18} />
        </span>
        <div>
          <strong>购物流程</strong>
          <small>条件符合自动下单，有差异先确认</small>
        </div>
      </div>
      <ol>
        <li>
          <span>01</span>
          <div>
            <strong>搜索商品</strong>
            <small>匹配商城商品信息与库存</small>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>选择商品</strong>
            <small>优先选择推荐排序靠前的有货商品</small>
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
            <strong>创建订单</strong>
            <small>
              条件符合自动提交；有差异时，接受当前商品与报价后提交
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
