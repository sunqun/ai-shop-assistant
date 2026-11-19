import { NextResponse } from "next/server";
import { makeIntentSummary } from "@/lib/assistant-agent";
import { searchProductsForAgent } from "@/lib/agent/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchBody = { query?: unknown; cursor?: unknown; pageSize?: unknown; sessionId?: unknown };

export async function POST(request: Request) {
  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "请求格式无效。" },
      { status: 400 }
    );
  }
  if (typeof body.query !== "string" || !body.query.trim()) {
    return NextResponse.json(
      { code: "INVALID_QUERY", message: "请描述你想找的商品。" },
      { status: 400 }
    );
  }
  // 页面只能调整返回条数，不能传入排序字段、权重或数据库条件。
  const pageSize = Math.min(100, Math.max(1, Number(body.pageSize) || 20));
  const cursor =
    typeof body.cursor === "string" && body.cursor.length < 500 ? body.cursor : undefined;
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.length < 200 ? body.sessionId : undefined;
  try {
    // Agent 通过工具注册表调用商品目录 MCP，路由不再直接连接目录数据库服务。
    const result = await searchProductsForAgent(body.query, pageSize, cursor, sessionId);
    if (!result.ok) {
      return NextResponse.json(
        { code: result.code, message: result.message },
        { status: result.retryable ? 503 : 400 }
      );
    }
    return NextResponse.json({
      products: result.data.products,
      nextCursor: result.data.nextCursor,
      intentSummary: makeIntentSummary(result.intent),
      searchMode: result.searchMode,
      sessionId: result.sessionId,
    });
  } catch (error) {
    console.error(
      "assistant product search failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { code: "ASSISTANT_SEARCH_UNAVAILABLE", message: "助手暂时无法完成商品检索，请稍后重试。" },
      { status: 503 }
    );
  }
}
