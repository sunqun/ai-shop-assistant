/* eslint-disable @typescript-eslint/no-explicit-any */
import { LLMConfig, LLMClient, Message, Tool, InvokeOptions, InvokeResult } from "./type";
import { OpenAIClient } from "./OpenAIClient";
import { InvokeError } from "./error";

export class LLM extends EventTarget {
  config: LLMConfig;
  client: LLMClient;

  constructor(config: LLMConfig) {
    super();
    this.config = parseLLMConfig(config);

    const transport = new OpenAIClient(this.config);
    // 将重试收敛到 client 边界，使 LLM.invoke() 与使用 llm.client 的 ReAct 调用方共享同一策略。
    // 仅当工具显式声明其执行可安全重放时，工具失败才会被重试。
    this.client = {
      invoke: (messages, tools, abortSignal, options) =>
        withRetry(() => transport.invoke(messages, tools, abortSignal, options), {
          maxRetries: this.config.maxRetries,
          onRetry: (attempt, lastError) => {
            this.dispatchEvent(
              new CustomEvent("retry", {
                detail: { attempt, maxAttempts: this.config.maxRetries, lastError },
              })
            );
          },
        }),
    };
  }

  async invoke(
    messages: Message[],
    tools: Record<string, Tool>,
    abortSignal: AbortSignal,
    options?: InvokeOptions
  ): Promise<InvokeResult> {
    return this.client.invoke(messages, tools, abortSignal, options);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  settings: {
    maxRetries: number;
    onRetry: (attempt: number, lastError: Error) => void;
  }
) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: unknown) {
      // ① AbortError：用户主动取消 —— 任何情况下都不重试，原样抛出
      if ((error as any)?.name === "AbortError") throw error;
      // ② 非可重试错误（AUTH_ERROR / CONTEXT_LENGTH 等）—— 直接抛到最外层
      if (error instanceof InvokeError && !error.retryable) throw error;
      attempt++;
      // ③ 超过最大重试次数（注意 maxRetries 是"额外重试"，不含首次）
      if (attempt > settings.maxRetries) throw error;
      settings.onRetry(attempt, error as Error);

      // 简单固定 100ms 退避即可：
      // 因为我们同时有 NO_TOOL_CALL / INVALID_TOOL_ARGS 等"瞬时幻觉型"失败，没必要指数退避那么久
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export function parseLLMConfig(config: LLMConfig): LLMConfig {
  if (!config.baseURL || !config.model) {
    throw new Error("[PageAgent] LLM configuration required. Please provide: baseURL, model. ");
  }
  return {
    baseURL: config.baseURL,
    model: config.model,
    apiKey: config.apiKey,
    maxRetries: config.maxRetries ?? 2,
    disableNamedToolChoice: config.disableNamedToolChoice,
    customFetch: config.customFetch,
  };
}

// 从环境变量构建默认 LLM 客户端：baseURL/model/apiKey 缺失时直接抛错。
export function createLLMFromEnv(): LLM {
  const requiredEnv = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
  };
  return new LLM({
    baseURL: requiredEnv("MODEL_BASE_URL"),
    model: requiredEnv("MODEL"),
    apiKey: requiredEnv("DEEPSEEK_API_KEY"),
    maxRetries: 1,
  });
}
