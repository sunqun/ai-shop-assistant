/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ZodType } from 'zod'
export interface ToolSchema<T = unknown> {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown }
}

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool',
    content: string | null,
    tool_calls?: {
        id: string,
        type: 'function'
        function: {
            name: string,
            arguments: string,
        }
    }[]
    tool_call_id?: string // role = tool 时，需要指定 tool_call_id
    name?: string
}

export interface Tool<IParams = any, TResult = any> {
    description?: string
    /** Allow retrying execute failures only for tools known to be safe to repeat. */
    retryOnExecutionError?: boolean
    inputSchema: ZodType<IParams>
    execute: (params: IParams, context?: { signal?: AbortSignal }) => Promise<TResult>
}

export interface InvokeResult<TResult = unknown> {
    toolCall: {
        name: string, // 被调用的工具名，会和传入的 tools Record key 对上
        args: any // 解析并通过 Zod 校验之后的参数对象（不是字符串）
    }
    toolResult: TResult // tool.execute 返回值
    usage: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
        cachedTokens: number
        reasoningTokens: number
    }
    rawResponse?: unknown // 原始完整 API 返回对象（用于排查）
    rawRequest?: unknown // 实际发送给 API 的 body（用于排查）
    assistantMessage?: Message
    toolCallId?: string
}

export interface InvokeOptions {
    toolChoiceName?: string // 必须调用某个具体工具
    normalizeResponse?: (response: any) => any
    temperature?: number // 采样温度，用于需要确定性的调用（如意图解析）
}

export interface LLMConfig {
    baseURL: string
    model: string
    apiKey: string
    maxRetries: number
    disableNamedToolChoice?: boolean // 是否禁用具名调用
    customFetch?: typeof globalThis.fetch
}

export interface LLMClient {
    invoke(
        message: Message[],
        tools: Record<string, Tool>,
        abortSignal?: AbortSignal,
        options?: InvokeOptions
    ): Promise<InvokeResult>
}
