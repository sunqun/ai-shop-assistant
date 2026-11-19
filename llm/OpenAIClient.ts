/* eslint-disable @typescript-eslint/no-explicit-any */
import { LLMConfig, LLMClient, InvokeResult, InvokeOptions, Message, Tool } from './type'
import { zodToOpenAITool } from './utils'
import { InvokeError, InvokeErrorTypes } from './error'


export class OpenAIClient implements LLMClient {
    config: LLMConfig
    private fetch: typeof globalThis.fetch

    constructor(config: LLMConfig) {
        this.config = config
        this.fetch = config.customFetch ?? globalThis.fetch
    }

    async invoke(
        messages: Message[],
        tools: Record<string, Tool>,
        abortSignal?: AbortSignal,
        options?: InvokeOptions
    ): Promise<InvokeResult> {
        // 协作取消的入口
        abortSignal?.throwIfAborted()

        // 1. 把业务层定义的tools转换工具调用格式为 OpenAI 格式
        const openaiTools = Object.entries(tools).map(([name, tool]) => zodToOpenAITool(name, tool))
        
        // 2、默认toolChoice = 'required': 强调必须调用工具
        let toolChoice:unknown = 'required'
        if (options?.toolChoiceName && !this.config.disableNamedToolChoice) {
            toolChoice = {
                type: 'function',
                function: {
                    name: options?.toolChoiceName,
                }
            }
        }
        const requestBody: Record<string, unknown> = {
            model: this.config.model,
            messages,
            tools: openaiTools,
            tool_choice: toolChoice,
        }

        // DeepSeek 的 thinking 模式不支持 tool_choice：关闭思考并删除 tool_choice（默认仍会调用工具）
        if (/deepseek/i.test(this.config.model) || /deepseek/i.test(this.config.baseURL)) {
            requestBody.thinking = { type: 'disabled' }
            delete requestBody.tool_choice
        }

        let response: Response
		try {
			response = await this.fetch(`${this.config.baseURL}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					// 有 API Key 才带 Authorization；本地 Ollama 等不带 key
					...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
				},
				body: JSON.stringify(requestBody),
				signal: abortSignal,
			})
		} catch (error: unknown) {
			// AbortError 要原样透传，不包 InvokeError —— 外层 withRetry 看到 AbortError 直接停止重试
			if ((error as any)?.name === 'AbortError') throw error
			console.error(error)
			throw new InvokeError(InvokeErrorTypes.NETWORK_ERROR, 'Network request failed', error)
		}

        // 错误解析
        if (!response.ok) {
            let errorData: any
            try {
                errorData = await response.json()
            } catch(error) {
                if ((error as any)?.name === 'AbortError') throw error
            }
            const errorMessage = errorData?.error?.message || response.statusText

            if (response.status === 401 || response.status === 403) {
                // API 错
                throw new InvokeError(
                    InvokeErrorTypes.AUTH_ERROR,
                    `Authentication failed: ${errorMessage}`,
                    errorData
                )
            }

            if (response.status === 429) {
                // 限流
                throw new InvokeError(
                    InvokeErrorTypes.RATE_LIMIT,
                    `Rate limit exceeded: ${errorMessage}`,
                    errorData
                )
            }

            if (response.status >= 500) {
                // 服务器错误
                throw new InvokeError(
                    InvokeErrorTypes.SERVER_ERROR,
                    `Server error: ${errorMessage}`,
                    errorData
                )
            }
            // 其他 4xx 没命中已知分支 → UNKNOWN
            throw new InvokeError(
                InvokeErrorTypes.UNKNOWN,
                `HTTP ${response.status}: ${errorMessage}`,
                errorData
            )
        }

        // 解析响应
        let data: any
        try {
            data = await response.json()
        } catch(error) {
            if ((error as any)?.name === 'AbortError') throw error
            // 返回的不是 JSON 格式
            throw new InvokeError(
                InvokeErrorTypes.INVALID_RESPONSE,
                `Response body is not valid JSON`,
                error
            )
        }
        
        // 解析返回的接口，必须有choices[0]
        const choice = data?.choices?.[0]
        if (!choice) {
            throw new InvokeError(
                InvokeErrorTypes.INVALID_SCHEMA,
                `No choices in response`,
                data
            )
        }

        // 解析结束原因
        switch(choice.finish_reason) {
            case 'tool_calls':
            case 'function_call':
            case 'stop':
                break
            case 'length':
                // 响应长度超过最大限制
                throw new InvokeError(
                    InvokeErrorTypes.CONTEXT_LENGTH,
                    'Response truncated: max tokens reached',
                    undefined,
                    data
                )
            case 'content_filter':
                // 安全系统过滤
                throw new InvokeError(
                    InvokeErrorTypes.CONTENT_FILTER,
                    'Content filtered by safety system',
                    undefined,
                    data
                )
            default:
                throw new InvokeError(
                    InvokeErrorTypes.INVALID_SCHEMA,
                    `Unexpected finish_reason: ${choice.finish_reason}`,
                    undefined,
                    data
                )
        }

        // 响应标准化钩子：在解析之前给调用方修补数据格式的机会（主要兼容小众模型/代理）
		const normalizedData = options?.normalizeResponse ? options.normalizeResponse(data) : data
		const normalizedChoice = (normalizedData as any).choices?.[0]

        // 工具名：必须有 tool_calls[0].function.name
		const toolCallName = normalizedChoice?.message?.tool_calls?.[0]?.function?.name
		if (!toolCallName) {
			throw new InvokeError(
				InvokeErrorTypes.NO_TOOL_CALL,
				'No tool call found in response',
				undefined,
				data
			)
		}

        // 工具存在性：LLM 返回的工具名必须在本次传入的 tools 里（幻觉输出其他名字 → 错）
		const tool = tools[toolCallName]
		if (!tool) {
			throw new InvokeError(
				InvokeErrorTypes.UNKNOWN,
				`Tool "${toolCallName}" not found in tools`,
				undefined,
				data
			)
		}

        // 工具参数：先拿 arguments 字符串
        // 带了 tool_calls 但参数 JSON 非法 / Zod 校验失败，重试
        const argString = normalizedChoice.message?.tool_calls?.[0]?.function?.arguments
		if (!argString) {
			throw new InvokeError(
				InvokeErrorTypes.INVALID_TOOL_ARGS,
				'No tool call arguments found',
				undefined,
				data
			)
		}

        // 有些模型会把已经是对象的东西再嵌一层，这里只处理字符串
        let parsedArgs: unknown
        try {
            parsedArgs = JSON.parse(argString)
        } catch (error) {
            throw new InvokeError(
                InvokeErrorTypes.INVALID_TOOL_ARGS,
                'Failed to parse tool arguments as JSON',
                error,
                data
            )
        }

        // Zod校验：
        const validation = tool.inputSchema.safeParse(parsedArgs)
        if (!validation.success) {
            // 打印 Zod 的漂亮格式化错误，方便调试时一眼看到是哪个字段错了
            throw new InvokeError(
                InvokeErrorTypes.INVALID_TOOL_ARGS,
                'Tool arguments validation failed',
                validation.error,
                data
            )
        }

        const toolInput = validation.data
        // 执行工具
        let toolResult: unknown
        try {
            toolResult = await tool.execute(toolInput, { signal: abortSignal })
        } catch (error) {
            // AbortError 透传
			if ((error as any)?.name === 'AbortError') throw error
			throw new InvokeError(
				InvokeErrorTypes.TOOL_EXECUTION_ERROR,
				`Tool execution failed: ${(error as Error)?.message}`,
				error,
				data
			)
        }

        return {
            toolCall: {
                name: toolCallName,
                args: toolInput
            },
            toolResult,
            usage: {
                promptTokens: data.usage?.prompt_tokens ?? 0,
                completionTokens: data.usage?.completion_tokens ?? 0,
                totalTokens: data.usage?.total_tokens ?? 0,
                cachedTokens: data.usage?.cached_tokens ?? 0,
                reasoningTokens: data.usage?.reasoning_tokens ?? 0,
            },
            rawResponse: data,
            rawRequest: requestBody,
            assistantMessage: normalizedChoice.message,
            toolCallId: normalizedChoice.message?.tool_calls?.[0]?.id,
        }
    }
}
