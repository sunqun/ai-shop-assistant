import { NextResponse } from "next/server";
import { setSession } from "@/lib/auth-server";
import { verifyPassword } from "@/lib/password";
import { findUserByUsername, authorizeUser } from "@/lib/user-repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown; authorizationConsent?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求参数格式错误" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password)
    return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });

  try {
    const user = await findUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }
    const consent = body.authorizationConsent === true;
    const currentUser = consent && !user.isAuthorized ? await authorizeUser(user.userid) : user;
    await setSession(user.userid);
    return NextResponse.json({
      user: {
        userid: user.userid,
        username: user.username,
        isAuthorized: currentUser?.isAuthorized ?? user.isAuthorized,
      },
    });
  } catch (error) {
    console.error("login failed", error);
    return NextResponse.json({ error: "登录服务暂不可用" }, { status: 503 });
  }
}
