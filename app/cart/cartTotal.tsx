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
        {quoteState === "ready" && quote ? (
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
        {!isAuthorized ? (
          <p className="cart-total__notice">尚未完成下单授权，请前往「订单」页完成授权。</p>
        ) : null}
        <button
          className="cart-total__pay"
          type="button"
          disabled={quoteState !== "ready" || !isAuthorized || submitting || itemCount === 0}
          onClick={onPay}
        >
          {submitting ? "正在创建订单…" : "付款"}
        </button>
      </div>
    </aside>
  );
}
