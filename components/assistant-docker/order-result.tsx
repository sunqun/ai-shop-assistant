"use client";

import { X } from "lucide-react";
import type { OrderReceipt } from "./types";

function formatMinor(value: number) {
  return `NT$${Math.round(value / 100).toLocaleString()}`;
}

export function OrderResultDialog({
  receipt,
  onClose,
  onViewOrders,
}: {
  receipt: OrderReceipt;
  onClose: () => void;
  onViewOrders: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="订单回执"
      onClick={onClose}
    >
      <div className="auth-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="auth-dialog__header">
          <h2>下单成功</h2>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭回执"
          >
            <X size={18} />
          </button>
        </div>
        <div className="assistant-detail__body">
          <div className="list-item">
            <div>
              <p className="list-item__title">{receipt.productName}</p>
              <p className="list-item__meta">
                数量：{receipt.quantity} · 单价：NT${receipt.unitPrice.toLocaleString()}
              </p>
            </div>
            <strong>
              {formatMinor(receipt.subtotalMinor)}
            </strong>
          </div>
          <div className="cart-summary__line">
            <span>商品小计</span>
            <strong>{formatMinor(receipt.subtotalMinor)}</strong>
          </div>
          <div className="cart-summary__line">
            <span>优惠</span>
            <strong>{formatMinor(receipt.discountMinor)}</strong>
          </div>
          <div className="cart-summary__line">
            <span>运费</span>
            <strong>{formatMinor(receipt.shippingMinor)}</strong>
          </div>
          <div className="cart-summary__total">
            <span>订单金额</span>
            <strong>{formatMinor(receipt.totalMinor)}</strong>
          </div>
          <p className="assistant-detail__meta">订单编号：{receipt.orderGroupId}</p>
          <div className="assistant-result__actions">
            <button
              className="button button--soft"
              type="button"
              onClick={onViewOrders}
            >
              查看订单
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
