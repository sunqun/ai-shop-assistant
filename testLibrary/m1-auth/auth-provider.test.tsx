import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthProvider, LoginButton } from "@/components/auth-provider";

function mockSession(user: { userid: string; username: string; isAuthorized: boolean } | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user }),
    })
  );
}

describe("AuthProvider / LoginButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未登录时显示登录按钮", async () => {
    mockSession(null);
    render(
      <AuthProvider>
        <LoginButton />
      </AuthProvider>
    );

    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("已登录时显示用户名和退出按钮", async () => {
    mockSession({ userid: "u1", username: "孙群", isAuthorized: false });
    render(
      <AuthProvider>
        <LoginButton />
      </AuthProvider>
    );

    expect(await screen.findByText("孙群")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出" })).toBeInTheDocument();
  });
});
