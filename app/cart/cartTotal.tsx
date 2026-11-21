import type { CartQuote } from "./type";

function formatMinor(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export function CartTotal({
  quote,
  quoteState,
  inventoryState,
  isAuthorized,
  submitting,
  itemCount,
  onPay,
}: {
  quote: CartQuote | null;
  quoteState: "idle" | "loading" | "ready" | "error";
  inventoryState: "idle" | "loading" | "ready" | "error";
  isAuthorized: boolean;
  submitting: boolean;
  itemCount: number;
  onPay: () => void;
}) {
  return (
    <aside className="cart-total">
      <div className="cart-total__head">
        <span>预计应付</span>
        {itemCount === 0 ? <strong className="cart-total__amount">{formatMinor(0)}</strong> : quoteState === "ready" && quote ? (
          <strong className="cart-total__amount">{formatMinor(quote.totalDueMinor)}</strong>
        ) : (
          <span className="cart-total__amount cart-total__amount--pending">
            {inventoryState === "ready" ? "计算中" : "待确认"}
          </span>
        )}
      </div>

      {quoteState === "ready" && quote ? (
        <dl className="cart-total__lines">
          <div className="cart-total__line">
            <dt>商品小计</dt>
            <dd>{formatMinor(quote.subtotalMinor)}</dd>
          </div>
          <div className="cart-total__line">
            <dt>折扣减免</dt>
            <dd>
              {quote.discountMinor ? `-${formatMinor(quote.discountMinor)}` : formatMinor(0)}
            </dd>
          </div>
          <div className="cart-total__line">
            <dt>运费</dt>
            <dd>{quote.shippingMinor ? formatMinor(quote.shippingMinor) : "免运费"}</dd>
          </div>
        </dl>
      ) : null}

      <div className="cart-total__foot">
        <p className="cart-total__notice">{itemCount === 0 ? "请勾选需要结算的商品。" : `仅结算已勾选的 ${itemCount} 件商品。`}</p>
        {quoteState === "error" || inventoryState === "error" ? <p className="cart-total__notice" role="alert">库存或报价暂时无法确认，请刷新后重试。</p> : null}
        {!isAuthorized ? (
          <p className="cart-total__notice">尚未完成下单授权，请前往「订单」页完成授权。</p>
        ) : null}
        <button
          className="cart-total__pay"
          type="button"
          disabled={!quote || inventoryState !== "ready" || quoteState !== "ready" || !isAuthorized || submitting || itemCount === 0}
          onClick={onPay}
        >
          {submitting ? "正在创建订单…" : "付款"}
        </button>
      </div>
    </aside>
  );
}
