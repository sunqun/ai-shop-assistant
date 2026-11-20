import { NextResponse } from "next/server";
import { z } from "zod";
import { shoppingTaskResponse } from "@/lib/agent/shopping-task-http";
import { createShoppingTask } from "@/lib/agent/shopping-task-service";
import { getActiveTask, taskView } from "@/lib/agent/shopping-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    mode: z.enum(["manual", "auto"]),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export async function POST(request: Request) {
  return shoppingTaskResponse(async (userid) => {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { code: "INVALID_TASK_REQUEST", message: "请提供有效的购物需求和交互模式。" },
        { status: 400 }
      );
    return NextResponse.json(
      { task: await createShoppingTask({ ...parsed.data, userid }) },
      { status: 202 }
    );
  });
}

export async function GET() {
  return shoppingTaskResponse(async (userid) => {
    const task = await getActiveTask(userid);
    return NextResponse.json({ task: task ? taskView(task) : null });
  });
}
