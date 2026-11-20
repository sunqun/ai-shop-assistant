import type { CatalogProduct } from "@/lib/catalog";
import type { OrderToolOutput, QuoteToolOutput } from "@/lib/mcp/types";

export type ShoppingMode = "manual" | "auto";
export type ShoppingPhase =
  | "queued"
  | "searching"
  | "selecting"
  | "reconciling"
  | "quoting"
  | "awaiting_confirmation"
  | "ready_to_order"
  | "committing"
  | "cancel_pending"
  | "link_creating"
  | "ordered"
  | "canceled"
  | "canceled_no_product"
  | "canceled_link_failed"
  | "failed"
  | "reconciling_result";

export type ShoppingTaskData = {
  product?: CatalogProduct;
  quote?: QuoteToolOutput;
  order?: OrderToolOutput;
  link?: { urlToken: string };
  error?: string;
  errorCode?: string;
};

export type ShoppingTask = ShoppingTaskData & {
  taskId: string;
  query: string;
  mode: ShoppingMode;
  phase: ShoppingPhase;
  revision: number;
  commitAfter: string | null;
  canCancel: boolean;
  canConfirm: boolean;
  canAdvance: boolean;
  canRecover: boolean;
  terminal: boolean;
};

export const CANCELLABLE_PHASES: readonly ShoppingPhase[] = [
  "queued",
  "searching",
  "selecting",
  "reconciling",
  "quoting",
  "awaiting_confirmation",
  "ready_to_order",
];
export const TERMINAL_PHASES: readonly ShoppingPhase[] = [
  "ordered",
  "canceled",
  "canceled_no_product",
  "canceled_link_failed",
  "failed",
];

export const SHOPPING_PHASE_LABELS: Record<ShoppingPhase, string> = {
  queued: "准备开始购物流程",
  searching: "正在搜索商品",
  selecting: "正在选择有库存的商品",
  reconciling: "正在加入 AI 购物车",
  quoting: "正在核验库存并生成报价",
  awaiting_confirmation: "报价已生成，请确认下单或取消并生成短链",
  ready_to_order: "即将自动创建订单，可在开始前取消",
  committing: "正在创建订单，已停止接受取消",
  cancel_pending: "已接受取消，正在结束当前步骤",
  link_creating: "已停止直接下单，正在生成支付短链",
  ordered: "订单已提交",
  canceled: "已取消直接下单，并生成支付短链",
  canceled_no_product: "已取消；没有可用于生成短链的商品",
  canceled_link_failed: "已停止直接下单，但短链生成失败，可重试",
  failed: "购物流程未完成",
  reconciling_result: "订单结果待核对，请查询原任务，勿重复下单",
};
