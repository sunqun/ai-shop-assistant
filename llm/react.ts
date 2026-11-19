import type { LLMClient, Message, Tool } from './type'

export type ReActEvent =
    | { type: 'step_started'; step: number }
    | { type: 'tool_call'; name: string; args: unknown; step: number }
    | { type: 'tool_result'; name: string; result: unknown; step: number }
    | { type: 'final'; result: unknown; step: number }
    | { type: 'error'; error: unknown; step: number }

export type ReActResult<T = unknown> = {
    result: T
    messages: Message[]
    steps: number
    events: ReActEvent[]
}

export type ReActOptions = {
    maxSteps?: number
    abortSignal?: AbortSignal
    onEvent?: (event: ReActEvent) => void
}

export class ReActLimitError extends Error {
    readonly events: ReActEvent[]
    readonly messages: Message[]
    readonly steps: number

    constructor(maxSteps: number, events: ReActEvent[], messages: Message[]) {
        super(`ReAct exceeded the maximum of ${maxSteps} steps without a final answer`)
        this.name = 'ReActLimitError'
        this.events = events
        this.messages = messages
        this.steps = maxSteps
    }
}

/**
 * Tool-call based ReAct loop. The model observes each tool result before choosing
 * the next action; a final tool is used as an explicit, schema-validated stop.
 */
export async function runReAct<T>(
    client: LLMClient,
    messages: Message[],
    tools: Record<string, Tool>,
    finalToolName: string,
    options: ReActOptions = {},
): Promise<ReActResult<T>> {
    const history = [...messages]
    const events: ReActEvent[] = []
    const maxSteps = Math.max(1, Math.min(options.maxSteps ?? 8, 20))

    if (!tools[finalToolName]) throw new Error(`Final tool "${finalToolName}" is not registered`)

    const emit = (event: ReActEvent) => {
        events.push(event)
        options.onEvent?.(event)
    }

    for (let step = 1; step <= maxSteps; step += 1) {
        options.abortSignal?.throwIfAborted()
        emit({ type: 'step_started', step })
        let invocation
        try {
            invocation = await client.invoke(history, tools, options.abortSignal)
        } catch (error) {
            emit({ type: 'error', error, step })
            throw error
        }
        const assistant = invocation.assistantMessage ?? {
            role: 'assistant' as const,
            content: null,
            tool_calls: [],
        }
        history.push(assistant)
        emit({ type: 'tool_call', name: invocation.toolCall.name, args: invocation.toolCall.args, step })

        if (invocation.toolCall.name === finalToolName) {
            emit({ type: 'final', result: invocation.toolResult, step })
            return { result: invocation.toolResult as T, messages: history, steps: step, events }
        }

        emit({ type: 'tool_result', name: invocation.toolCall.name, result: invocation.toolResult, step })
        options.abortSignal?.throwIfAborted()
        let content: string
        try {
            content = JSON.stringify(invocation.toolResult)
        } catch (error) {
            emit({ type: 'error', error, step })
            throw new Error(`Tool "${invocation.toolCall.name}" returned a non-serializable result`, { cause: error })
        }
        history.push({
            role: 'tool',
            tool_call_id: invocation.toolCallId ?? `step-${step}`,
            name: invocation.toolCall.name,
            content,
        })
    }

    const error = new ReActLimitError(maxSteps, events, history)
    emit({ type: 'error', error, step: maxSteps })
    throw error
}
