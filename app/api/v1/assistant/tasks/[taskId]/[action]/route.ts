import { NextResponse } from "next/server";
import { z } from "zod";
import { shoppingTaskResponse } from "@/lib/shop-task/shopping-task-http";
import { actOnShoppingTask } from "@/lib/shop-task/shopping-task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const actionSchema = z.enum([
  "advance",
  "cancel",
  "confirm",
  "retry-link",
  "recover",
  "resume-after-reviews",
]);
const confirmationSchema = z
  .object({ cartVersion: z.number().int().positive(), quoteId: z.string().uuid() })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string; action: string }> }
) {
  return shoppingTaskResponse(async (userid) => {
    const { taskId, action } = await context.params;
    const parsed = actionSchema.safeParse(action);
    if (!z.string().uuid().safeParse(taskId).success || !parsed.success)
      return NextResponse.json(
        { code: "INVALID_TASK_ACTION", message: "购物任务操作无效。" },
        { status: 400 }
      );
    let confirmation: z.infer<typeof confirmationSchema> | undefined;
    if (parsed.data === "confirm") {
      const body = confirmationSchema.safeParse(await request.json().catch(() => null));
      if (!body.success)
        return NextResponse.json(
          { code: "INVALID_CONFIRMATION", message: "请提供当前任务的报价确认信息。" },
          { status: 400 }
        );
      confirmation = body.data;
    }
    return NextResponse.json({
      task: await actOnShoppingTask(userid, taskId, parsed.data, confirmation),
    });
  });
}
