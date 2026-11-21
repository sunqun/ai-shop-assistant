// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth/auth-server", () => ({ readSession: mocks.session }));
vi.mock("@/lib/repository/db", () => ({
  getDbPool: () => ({ query: mocks.query }),
}));
vi.mock("@/lib/shop-task/shopping-task-service", () => ({ createShoppingTask: vi.fn() }));

import { GET } from "@/app/api/v1/assistant/tasks/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userid: "new-user" });
});
afterEach(() => vi.restoreAllMocks());

describe("shopping task initialization", () => {
  it("returns an empty task for a user without task records", async () => {
    mocks.query.mockResolvedValue([[], []]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ task: null });
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(
      "SELECT * FROM shopping_tasks WHERE active_user = ?",
      ["new-user"]
    );
  });

  it("keeps missing schema visible as an unavailable service instead of an empty task", async () => {
    const error = Object.assign(new Error("Table 'shop.shopping_tasks' doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
    });
    mocks.query.mockRejectedValue(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "SHOPPING_TASK_UNAVAILABLE",
      message: "购物任务暂时无法处理，请稍后重试查询当前任务。",
    });
    expect(log).toHaveBeenCalledWith("shopping task request failed", error.message);
  });

  it("does not query tasks before authentication", async () => {
    mocks.session.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("fresh-install task schema equals the migrated schema without the removed mode column", () => {
    const ddl = readFileSync(new URL("../../db/ddl.sql", import.meta.url), "utf8");
    const migration = readFileSync(
      new URL("../../db/migrations/011_create_shopping_tasks.sql", import.meta.url),
      "utf8"
    );
    const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();

    expect(normalize(ddl)).toContain(normalize(migration.replace(/^  mode VARCHAR\(10\) NOT NULL,\r?\n/m, "")));
    expect(ddl.indexOf("CREATE TABLE IF NOT EXISTS shopping_tasks")).toBeGreaterThan(
      ddl.indexOf("CREATE TABLE IF NOT EXISTS users")
    );
  });
});
