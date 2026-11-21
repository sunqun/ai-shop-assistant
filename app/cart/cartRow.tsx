import { lineSubtotalMinor } from "@/lib/pricing-domain";
import type { CartLine } from "./type";
import { TrashIcon } from "lucide-react";

function formatMinor(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export function CartRow({
  line,
  checked,
  disabled,
  onSelect,
  onQuantityChange,
  onRemove,
}: {
  line: CartLine;
  checked: boolean;
  disabled: boolean;
  onSelect: (skuId: string, checked: boolean) => void;
  onQuantityChange: (skuId: string, quantity: number) => void;
  onRemove: (skuId: string) => void;
}) {
  const { item, product } = line;
  const subtotal =
    item.allocatedQuantity > 0
      ? formatMinor(lineSubtotalMinor(product.price, item.allocatedQuantity))
      : "库存确认后计算";

  function handleQuantityChange(value: string) {
    const quantity = Math.max(1, Math.min(product.stock || 1, Number(value) || 1));
    onQuantityChange(item.skuId, quantity);
  }

  return (
    <article className="cart-row">
      <input className="cart-checkbox" type="checkbox" checked={checked}
        disabled={disabled || item.allocatedQuantity <= 0}
        aria-label={`选择 ${product.name}`}
        onChange={(event) => onSelect(item.skuId, event.target.checked)} />
      <div
        className={`cart-row__visual cart-row__visual--${product.tone || "all"}`}
        aria-hidden="true"
      >
        {(product.brand || product.name).slice(0, 1)}
      </div>
      <div className="cart-row__content">
        <div className="cart-row__title">{product.name}</div>
        <div className="cart-row__brand">
          {product.brand} · {product.category}
        </div>
        <div className="cart-row__price">
          <div className="cart-row__unit">
            单价{" "}
            <span className="cart-row__price--minor">NT${product.price.toLocaleString()}</span>{" "}
          </div>
          {item.unavailableQuantity > 0 ? (
            <div className="stock stock--out">
              缺货 <span className="cart-row__price--minor">{item.unavailableQuantity}</span>{" "}
              件，已锁定 <span className="cart-row__price--minor">{item.allocatedQuantity}</span> 件
            </div>
          ) : item.allocatedQuantity > 0 ? (
            <div className="stock stock--in">
              已锁定 <span className="cart-row__price--minor">{item.allocatedQuantity}</span> 件
            </div>
          ) : null}
        </div>
      </div>
      <label className="cart-quantity">
        <span className="sr-only">{product.name} 数量</span>
        <input
          type="number"
          disabled={disabled}
          min="1"
          max={product.stock || 1}
          value={item.requestedQuantity}
          onChange={(event) => handleQuantityChange(event.target.value)}
        />
      </label>
      <strong className="cart-row__subtotal">{subtotal}</strong>

      <button className="cart-remove" type="button" disabled={disabled} aria-label={`移除 ${product.name}`} onClick={() => onRemove(item.skuId)}>
        <TrashIcon size={14} />
      </button>
    </article>
  );
}
