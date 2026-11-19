import { NextResponse } from "next/server";
import { createUser } from "@/lib/auth/user-repository";
import { hashPassword } from "@/lib/auth/password";
import { assertSessionReady, setSession } from "@/lib/auth/auth-server";

export const runtime = "nodejs";

const MIN_PASSWORD_LENGTH = 8;
const MAX_USERNAME_LENGTH = 191;
const MAX_PASSWORD_LENGTH = 128;

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown; confirmPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求参数格式错误" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  if (!username) return NextResponse.json({ error: "请输入用户名" }, { status: 400 });
  if (username.length > MAX_USERNAME_LENGTH)
    return NextResponse.json({ error: "用户名过长" }, { status: 400 });
  if (password.length < MIN_PASSWORD_LENGTH)
    return NextResponse.json({ error: "密码至少需要 8 个字符" }, { status: 400 });
  if (password.length > MAX_PASSWORD_LENGTH)
    return NextResponse.json({ error: "密码过长" }, { status: 400 });
  if (password !== confirmPassword)
    return NextResponse.json({ error: "两次输入的密码不一致" }, { status: 400 });

  try {
    // Validate this before inserting so a missing production secret cannot
    // create an account that cannot receive a session.
    assertSessionReady();
    const user = await createUser(username, await hashPassword(password));
    await setSession(user.userid);
    return NextResponse.json(
      {
        user: { userid: user.userid, username: user.username, isAuthorized: user.isAuthorized },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ER_DUP_ENTRY"
    ) {
      return NextResponse.json(
        { error: "用户名已存在", code: "USERNAME_ALREADY_EXISTS" },
        { status: 409 }
      );
    }
    console.error("registration failed", error);
    return NextResponse.json({ error: "注册服务暂不可用" }, { status: 503 });
  }
}
