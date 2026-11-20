import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/auth-server";
import { runShoppingReAct } from "@/lib/agent/auto-shopping";
import { getActiveTask } from "@/lib/shop-task/shopping-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await readSession();
  if (!session)
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "请先登录后使用购物助手。", requestId: randomUUID() },
      { status: 401 }
    );
  let body: { query?: unknown; sessionId?: unknown; confirmOrder?: unknown };
  try {
    if (await getActiveTask(session.userid))
      return NextResponse.json(
        { code: "ACTIVE_TASK_EXISTS", message: "已有购物任务正在执行，请在助手页面完成或取消。" },
        { status: 409 }
      );
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: "INVALID_JSON", message: "请求格式无效。" }, { status: 400 });
  }
  if (typeof body.query !== "string" || !body.query.trim())
    return NextResponse.json(
      { code: "INVALID_QUERY", message: "请描述你想购买的商品。" },
      { status: 400 }
    );
  try {
    const result = await runShoppingReAct({
      query: body.query,
      userid: session.userid,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      confirmOrder: body.confirmOrder === true,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "shopping ReAct failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { code: "ASSISTANT_REACT_UNAVAILABLE", message: "购物助手暂时无法完成流程。" },
      { status: 503 }
    );
  }
}
