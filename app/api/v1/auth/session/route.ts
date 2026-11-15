import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth-server";
import { findUserById } from "@/lib/user-repository";

export const runtime = "nodejs";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ user: null });
  try {
    const user = await findUserById(session.userid);
    if (!user) return NextResponse.json({ user: null });
    return NextResponse.json({
      user: { userid: user.userid, username: user.username, isAuthorized: user.isAuthorized },
    });
  } catch (error) {
    console.error("session lookup failed", error);
    return NextResponse.json({ error: "会话服务暂不可用" }, { status: 503 });
  }
}
