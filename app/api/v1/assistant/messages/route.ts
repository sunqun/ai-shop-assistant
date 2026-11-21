import { NextResponse } from "next/server";
import { z } from "zod";
import { shoppingTaskResponse } from "@/lib/shop-task/shopping-task-http";
import { handleAssistantMessage } from "@/lib/agent/dialogue-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const schema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    mode: z.enum(["manual", "auto"]),
    idempotencyKey: z.string().uuid(),
    taskId: z.string().uuid().optional(),
    quote: z
      .object({ quoteId: z.string().min(1).max(100), cartVersion: z.number().int().nonnegative() })
      .strict()
      .optional(),
  })
  .strict();
export async function POST(request: Request) {
  return shoppingTaskResponse(async (userid) => {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { code: "INVALID_MESSAGE", message: "请提供有效的消息和任务上下文。" },
        { status: 400 }
      );
    return NextResponse.json(await handleAssistantMessage({ ...parsed.data, userid }));
  });
}
