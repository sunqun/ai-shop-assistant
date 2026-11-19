import { z } from 'zod'
import { Tool } from './type'

// 把 Zod Schema 定义的 Tool 转成 OpenAI 工具调用格式
export function zodToOpenAITool(name: string, tool: Tool) {
    return {
        type: 'function' as const,
        function: {
            name,
            description: tool.description,
            parameters: z.toJSONSchema(tool.inputSchema),
        }
    }
}
