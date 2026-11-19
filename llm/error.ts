export const InvokeErrorTypes = {
	// ===== 可重试错误 =====
	NETWORK_ERROR: 'network_error', // fetch 抛异常（DNS/SSL/超时/断网），重试
	RATE_LIMIT: 'rate_limit', // 429 限流，重试
	SERVER_ERROR: 'server_error', // 5xx 服务端错误，重试
	NO_TOOL_CALL: 'no_tool_call', // LLM 响应正常但没带 tool_calls（胡说八道），重试
	INVALID_TOOL_ARGS: 'invalid_tool_args', // 带了 tool_calls 但参数 JSON 非法 / Zod 校验失败，重试
	TOOL_EXECUTION_ERROR: 'tool_execution_error', // 工具 execute 里 throw（比如 DOM 元素找不到），重试
	INVALID_RESPONSE: 'invalid_response', // HTTP 响应 body 不是合法 JSON，重试
	INVALID_SCHEMA: 'invalid_schema', // JSON 合法但缺少 choices / finish_reason 等字段，重试

	UNKNOWN: 'unknown',

	// ===== 不可重试错误（遇到直接抛到最外层）=====
	CONFIG_ERROR: 'config_error', // 本地配置错，比如 transformRequestBody 里 throw
	AUTH_ERROR: 'auth_error', // 401/403，API Key 错
	CONTEXT_LENGTH: 'context_length', // finish_reason=length，Prompt 太长 / max_tokens 不够
	CONTENT_FILTER: 'content_filter', // 被安全系统过滤
} as const

// 可重试错误名单
const RETRYABLE_TYPES: readonly InvokeErrorType[] = [
	InvokeErrorTypes.NETWORK_ERROR,
	InvokeErrorTypes.RATE_LIMIT,
	InvokeErrorTypes.SERVER_ERROR,
	InvokeErrorTypes.NO_TOOL_CALL,
	InvokeErrorTypes.INVALID_TOOL_ARGS,
	InvokeErrorTypes.TOOL_EXECUTION_ERROR,
	InvokeErrorTypes.INVALID_RESPONSE,
	InvokeErrorTypes.INVALID_SCHEMA,
	InvokeErrorTypes.UNKNOWN,
]


type InvokeErrorType = (typeof InvokeErrorTypes)[keyof typeof InvokeErrorTypes]

export class InvokeError extends Error {
	type: InvokeErrorType // 分类枚举值，供上层 switch 判断
	retryable: boolean // 由 RETRYABLE_TYPES 自动判定，withRetry 看这个字段决定是否重试
	statusCode?: number // HTTP 状态码（如果是 HTTP 层产生的）
	/* 本错误由其他错误触发时保留原始错误对象，用于排查 */
	rawError?: unknown
	/* 本错误由 API 调用返回异常时保留响应体，用于排查 */
	rawResponse?: unknown

	constructor(type: InvokeErrorType, message: string, rawError?: unknown, rawResponse?: unknown) {
		super(message)
		this.name = 'InvokeError'
		this.type = type
		this.retryable = RETRYABLE_TYPES.includes(type) // ⭐ 自动打标签，别让每个调用点手动设置
		this.rawError = rawError
		this.rawResponse = rawResponse
	}
}
