/**
 * 购物任务（Shopping Task）的领域类型定义。
 *
 * 集中声明购物任务的状态机相关类型与常量，供 store / service / http 层共享：
 *   - ShoppingPhase：任务生命周期阶段
 *   - ShoppingTaskData：任务承载的业务数据快照（商品/报价/订单/短链/错误）
 *   - ShoppingTask：返回给前端的任务视图（含操作能力位）
 *   - CANCELLABLE_PHASES / TERMINAL_PHASES：可取消阶段与终态阶段集合
 *   - SHOPPING_PHASE_LABELS：各阶段的中文展示文案
 */
import type { CatalogProduct } from "@/lib/catalog";
import type { OrderToolOutput, QuoteToolOutput } from "@/lib/mcp/types";
import type { DialogueSnapshot } from "@/lib/intent/type";
import type {
  ReviewAnalysisProgress,
  ReviewAnalysisReport,
} from "@/lib/reviews/types";

// 任务生命周期阶段（详见 SHOPPING_PHASE_LABELS 的中文说明）。
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
  | "needs_clarification"
  | "reconciling_result";

// 任务在执行过程中逐步写入的业务数据快照（可选字段表示尚未产生）。
export type ShoppingTaskData = {
  differences?: import("@/lib/catalog/types").ProductDifference[];
  acceptedQuote?: {
    quoteId: string;
    cartVersion: number;
    productId: string;
    quantity: number;
    differences: import("@/lib/catalog/types").ProductDifference[];
    acceptedAt: string;
  };
  product?: CatalogProduct; // 已选商品
  quantity?: number; // 已核实的本次请求件数
  quote?: QuoteToolOutput; // 报价结果
  order?: OrderToolOutput; // 订单结果
  link?: { urlToken: string }; // 取消后生成的支付短链
  error?: string; // 面向用户的错误文案
  errorCode?: string; // 业务错误码
  clarification?: string; // 需要用户澄清的提示
  dialogue?: DialogueSnapshot; // 对话状态：已填条件、待填槽位和本轮路由来源
  reviewProgress?: ReviewAnalysisProgress;
  reviewAnalysis?: ReviewAnalysisReport;
  reviewHold?: boolean;
};

// 返回给前端的任务视图：在业务数据之上叠加任务元信息与操作能力位。
export type ShoppingTask = Omit<ShoppingTaskData, "reviewProgress"> & {
  taskId: string;
  query: string;
  phase: ShoppingPhase;
  revision: number; // 每次状态迁移递增，用于并发/一致性判断
  commitAfter: string | null; // 自动提交的截止时间
  canCancel: boolean; // 当前是否可取消
  canConfirm: boolean; // 当前是否可确认下单
  canAdvance: boolean; // 当前是否可推进
  canRecover: boolean; // 当前是否可恢复
  terminal: boolean; // 是否已到达终态
  canResumeAfterReviews?: boolean;
};

// 可取消阶段：在这些阶段收到 cancel 才会进入 cancel_pending。
export const CANCELLABLE_PHASES: readonly ShoppingPhase[] = [
  "queued",
  "searching",
  "selecting",
  "reconciling",
  "quoting",
  "awaiting_confirmation",
  "ready_to_order",
];

// 终态阶段：到达后不再接受任何动作推进。
export const TERMINAL_PHASES: readonly ShoppingPhase[] = [
  "ordered",
  "canceled",
  "canceled_no_product",
  "canceled_link_failed",
  "failed",
  "needs_clarification",
];

// 各阶段的中文展示文案，供前端渲染任务进度。
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
  needs_clarification: "已找到候选商品，请查看商品卡片及待确认条件",
  reconciling_result: "订单结果待核对，请查询原任务，勿重复下单",
};
