import type { UserOrderView } from "./type";

function money(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export function OrderCard({
  order,
  expanded,
  onToggle,
}: {
  order: UserOrderView;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="order">
      <header className="order__head">
        <div className="order__source">
          <span className={`order__badge${!!order.shoppingTaskId ? " order__badge--ai" : ""}`}>
            {!!order.shoppingTaskId ? "AI 下单" : "自主下单"}
          </span>
          <span className="order__id">{order.orderGroupId}</span>
        </div>
        <time className="order__time">{new Date(order.createdAt).toLocaleString()}</time>
      </header>
      <div className="order__items">
        {order.items.map((item) => (
          <div className="order__item" key={`${order.orderGroupId}-${item.skuId}`}>
            <div className="order__item-main">
              <span className="order__item-name">{item.productName}</span>
              <span className="order__item-meta">
                规格：{item.skuId} · 数量：{item.quantity}
              </span>
            </div>
            <span className="order__item-amount">{money(item.unitPriceMinor * item.quantity)}</span>
          </div>
        ))}
      </div>
      <footer className="order__foot">
        <button type="button" className="order-toggle" onClick={onToggle} aria-expanded={expanded}>
          <span>订单明细</span>
          <span className="order-toggle__chevron" aria-hidden="true">
            {expanded ? "▴" : "▾"}
          </span>
        </button>
        <strong className="order__total">总计 {money(order.totalMinor)}</strong>
      </footer>
      {expanded ? (
        <dl className="order__detail">
          <div className="order__detail-line">
            <dt>商品小计</dt>
            <dd>{money(order.subtotalMinor)}</dd>
          </div>
          <div className="order__detail-line">
            <dt>优惠</dt>
            <dd>{money(order.discountMinor)}</dd>
          </div>
          <div className="order__detail-line">
            <dt>运费</dt>
            <dd>{money(order.shippingMinor)}</dd>
          </div>
          <div className="order__detail-line">
            <dt>创建时间</dt>
            <dd>{new Date(order.createdAt).toLocaleString()}</dd>
          </div>
        </dl>
      ) : null}
    </article>
  );
}
