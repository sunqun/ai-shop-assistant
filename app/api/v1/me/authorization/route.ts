import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth-server";
import { authorizeUser, findUserById } from "@/lib/user-repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let body: { consent?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求参数格式错误" }, { status: 400 });
  }
  if (body.consent !== true)
    return NextResponse.json({ error: "请勾选授权后再保存" }, { status: 400 });

  try {
    const user = await findUserById(session.userid);
    if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 401 });
    const updatedUser = user.isAuthorized ? user : await authorizeUser(user.userid);
    return NextResponse.json({
      user: {
        userid: updatedUser?.userid ?? user.userid,
        username: updatedUser?.username ?? user.username,
        isAuthorized: updatedUser?.isAuthorized ?? true,
      },
    });
  } catch (error) {
    console.error("authorization update failed", error);
    return NextResponse.json({ error: "授权服务暂不可用" }, { status: 503 });
  }
}
