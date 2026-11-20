import { NextResponse } from "next/server";
import { z } from "zod";
import { shoppingTaskResponse } from "@/lib/shop-task/shopping-task-http";
import { getTask, taskView } from "@/lib/shop-task/shopping-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  return shoppingTaskResponse(async (userid) => {
    const { taskId } = await context.params;
    if (!z.string().uuid().safeParse(taskId).success)
      return NextResponse.json(
        { code: "INVALID_TASK_ID", message: "购物任务标识无效。" },
        { status: 400 }
      );
    return NextResponse.json({ task: taskView(await getTask(userid, taskId)) });
  });
}
