import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/auth-server";
import { ShoppingTaskError } from "./shopping-task-store";

export async function shoppingTaskResponse(
  action: (userid: string) => Promise<Response>
): Promise<Response> {
  const session = await readSession();
  if (!session)
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "请先登录后使用购物助手。" },
      { status: 401 }
    );
  try {
    return await action(session.userid);
  } catch (error) {
    if (error instanceof ShoppingTaskError)
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status }
      );
    console.error(
      "shopping task request failed",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        code: "SHOPPING_TASK_UNAVAILABLE",
        message: "购物任务暂时无法处理，请稍后重试查询当前任务。",
      },
      { status: 503 }
    );
  }
}
