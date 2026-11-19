import { randomUUID } from "node:crypto";
import type { ProductSearchIntent } from "@/lib/catalog";

/**
 * 服务端内存会话存储。
 *
 * 仅用于单实例部署：历史不落库、不跨实例，进程重启即失效。
 * 只保存最近若干轮的「查询文本 + 结构化意图摘要」，不保存未脱敏评论、
 * 内部排序分数、毛利或用户账户信息。
 */
export type AssistantTurn = {
  query: string;
  intent: ProductSearchIntent;
  intentSummary: string;
  createdAt: number;
};

const MAX_SESSIONS = 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_TURNS = 5;

type SessionRecord = { turns: AssistantTurn[]; updatedAt: number };

// 挂到 globalThis 上，避免 next dev 热更新重新评估模块时清空会话历史。
const globalStore = globalThis as unknown as {
  __assistantSessions?: Map<string, SessionRecord>;
};
const sessions = (globalStore.__assistantSessions ??= new Map<string, SessionRecord>());

function pruneExpired(now: number): void {
  for (const [id, record] of sessions) {
    if (now - record.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

function evictOldest(): void {
  if (sessions.size <= MAX_SESSIONS) return;
  let oldestId: string | null = null;
  let oldestAt = Infinity;
  for (const [id, record] of sessions) {
    if (record.updatedAt < oldestAt) {
      oldestAt = record.updatedAt;
      oldestId = id;
    }
  }
  if (oldestId) sessions.delete(oldestId);
}

export function getOrCreateSession(sessionId?: string): {
  sessionId: string;
  turns: AssistantTurn[];
} {
  const now = Date.now();
  pruneExpired(now);
  if (typeof sessionId === "string" && sessionId.length > 0 && sessionId.length < 200) {
    const existing = sessions.get(sessionId);
    if (existing) {
      existing.updatedAt = now;
      return { sessionId, turns: existing.turns };
    }
  }
  const id = randomUUID();
  sessions.set(id, { turns: [], updatedAt: now });
  evictOldest();
  return { sessionId: id, turns: [] };
}

export function appendTurn(
  sessionId: string,
  turn: { query: string; intent: ProductSearchIntent; intentSummary: string }
): void {
  const record = sessions.get(sessionId);
  if (!record) return;
  record.turns.push({ ...turn, createdAt: Date.now() });
  if (record.turns.length > MAX_TURNS) record.turns = record.turns.slice(-MAX_TURNS);
  record.updatedAt = Date.now();
}
