import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password", () => {
  it("哈希密码并验证成功", async () => {
    const hash = await hashPassword("secret-123");
    expect(hash).toMatch(/^scrypt\$.+\$.+$/);
    await expect(verifyPassword("secret-123", hash)).resolves.toBe(true);
  });

  it("错误密码验证失败", async () => {
    const hash = await hashPassword("secret-123");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("非法哈希返回 false", async () => {
    await expect(verifyPassword("secret-123", "not-a-hash")).resolves.toBe(false);
  });
});
