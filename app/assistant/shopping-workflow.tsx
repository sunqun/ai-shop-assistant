import { Bot, CircleAlert } from "lucide-react";

export function ShoppingWorkflow() {
  return (
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
  );
}
