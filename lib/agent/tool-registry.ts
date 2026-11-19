import {
  callAiQuoteCartTool,
  callAiReconcileCartTool,
  callAiSubmitOrderTool,
  callCatalogSearchTool,
  callCreatePaymentLinkTool,
} from "@/lib/mcp/client";
import type {
  AiCartToolOutput,
  AiOrderToolOutput,
  AiQuoteCartToolInput,
  AiQuoteToolOutput,
  AiReconcileCartToolInput,
  AiSubmitOrderToolInput,
  CatalogSearchToolInput,
  CatalogSearchToolOutput,
  CreatePaymentLinkToolInput,
  CreatePaymentLinkToolOutput,
  McpToolResult,
} from "@/lib/mcp/types";

/**
 * Agent 可见的工具注册表。
 * LLM 只能选择这里声明的业务工具，不能直接访问 MCP Server 或数据库。
 * search_products 检索商品
 * ai_reconcile_cart 合并购物车
 * ai_quote_cart 引用购物车
 * ai_submit_order 提交订单
 */
export const agentToolRegistry = {
  // 检索商品：无需用户上下文，直接透传搜索参数
  search_products: (
    input: CatalogSearchToolInput
  ): Promise<McpToolResult<CatalogSearchToolOutput>> => callCatalogSearchTool(input),
  // 合并购物车：将用户多来源/冲突的购物车项合并为一致状态
  ai_reconcile_cart: (
    input: AiReconcileCartToolInput,
    context: { userid: string }
  ): Promise<McpToolResult<AiCartToolOutput>> => callAiReconcileCartTool(input, context),
  // 引用购物车：基于当前购物车生成报价预览
  ai_quote_cart: (
    input: AiQuoteCartToolInput,
    context: { userid: string }
  ): Promise<McpToolResult<AiQuoteToolOutput>> => callAiQuoteCartTool(input, context),
  // 提交订单：按用户购物车内容正式下单
  ai_submit_order: (
    input: AiSubmitOrderToolInput,
    context: { userid: string }
  ): Promise<McpToolResult<AiOrderToolOutput>> => callAiSubmitOrderTool(input, context),
  // 创建支付链接：为订单生成可跳转的支付入口
  create_payment_link: (
    input: CreatePaymentLinkToolInput,
    context: { userid: string }
  ): Promise<McpToolResult<CreatePaymentLinkToolOutput>> => callCreatePaymentLinkTool(input, context),
} as const;

export type AgentToolName = keyof typeof agentToolRegistry;

// 所有工具输入/输出的联合类型，供统一调用入口做类型收窄
export type AgentToolInput =
  CatalogSearchToolInput | AiReconcileCartToolInput | AiQuoteCartToolInput | AiSubmitOrderToolInput | CreatePaymentLinkToolInput;
export type AgentToolOutput =
  CatalogSearchToolOutput | AiCartToolOutput | AiQuoteToolOutput | AiOrderToolOutput | CreatePaymentLinkToolOutput;

// 以下重载为每个工具提供精确签名，保证调用处能拿到对应类型的输入输出
export async function invokeAgentTool(
  name: "search_products",
  input: CatalogSearchToolInput
): Promise<McpToolResult<CatalogSearchToolOutput>>;
export async function invokeAgentTool(
  name: "ai_reconcile_cart",
  input: AiReconcileCartToolInput,
  context: { userid: string }
): Promise<McpToolResult<AiCartToolOutput>>;
export async function invokeAgentTool(
  name: "ai_quote_cart",
  input: AiQuoteCartToolInput,
  context: { userid: string }
): Promise<McpToolResult<AiQuoteToolOutput>>;
export async function invokeAgentTool(
  name: "ai_submit_order",
  input: AiSubmitOrderToolInput,
  context: { userid: string }
): Promise<McpToolResult<AiOrderToolOutput>>;
export async function invokeAgentTool(
  name: "create_payment_link",
  input: CreatePaymentLinkToolInput,
  context: { userid: string }
): Promise<McpToolResult<CreatePaymentLinkToolOutput>>;

export async function invokeAgentTool(
  name: AgentToolName,
  input: AgentToolInput,
  context?: { userid: string }
): Promise<McpToolResult<AgentToolOutput>> {
  // 需要用户上下文的工具单独透传 userid，其余（如 search_products）无需上下文
  if (name === "ai_submit_order" || name === "ai_reconcile_cart" || name === "ai_quote_cart" || name === "create_payment_link")
    return agentToolRegistry[name](input as never, context as { userid: string }) as Promise<
      McpToolResult<AgentToolOutput>
    >;
  return agentToolRegistry[name](input as never) as Promise<McpToolResult<AgentToolOutput>>;
}
