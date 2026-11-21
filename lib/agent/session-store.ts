import { randomUUID } from "node:crypto";
import type { DialogueContext } from "@/lib/intent/type";
import type { IntentHistoryTurn } from "@/lib/intent/type";

/**
 * 服务端内存会话存储。
 *
 * 仅用于单实例部署：历史不落库、不跨实例，进程重启即失效。
 * 只保存最近若干轮的「查询文本 + 结构化意图摘要」，不保存未脱敏评论、
 * 内部排序分数、毛利或用户账户信息。
 */
// 会话数量上限：超过后淘汰最久未更新的会话。
const MAX_SESSIONS = 1000;
// 会话过期时间：30 分钟未更新即视为失效。
const SESSION_TTL_MS = 30 * 60 * 1000;
// 单会话最多保留的轮次数量。
const MAX_TURNS = 5;

// 单个会话的记录：轮次列表 + 最近更新时间。
type SessionRecord = { turns: IntentHistoryTurn[]; updatedAt: number; context?: DialogueContext };

// 挂到 globalThis 上，避免 next dev 热更新重新评估模块时清空会话历史。
const globalStore = globalThis as unknown as {
  __assistantSessions?: Map<string, SessionRecord>;
};
const sessions = (globalStore.__assistantSessions ??= new Map<string, SessionRecord>());

// 清理所有已过期（超过 TTL 未更新）的会话。
function pruneExpired(now: number): void {
  for (const [id, record] of sessions) {
    if (now - record.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// 会话数超过上限时，淘汰最久未更新的一个会话。
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

// 获取或创建会话：传入合法 sessionId 则复用（并刷新更新时间），否则新建一个。
export function getOrCreateSession(sessionId?: string): {
  sessionId: string;
  turns: IntentHistoryTurn[];
  context?: DialogueContext;
} {
  const now = Date.now();
  pruneExpired(now);
  // sessionId 合法（长度 1~199）且已存在时，直接复用该会话。
  if (typeof sessionId === "string" && sessionId.length > 0 && sessionId.length < 200) {
    const existing = sessions.get(sessionId);
    if (existing) {
      existing.updatedAt = now;
      return { sessionId, turns: existing.turns, context: existing.context };
    }
  }
  // 否则新建会话，并做一次容量淘汰。
  const id = randomUUID();
  sessions.set(id, { turns: [], updatedAt: now });
  evictOldest();
  return { sessionId: id, turns: [] };
}

export function updateSessionContext(sessionId: string, context: DialogueContext): void {
  const record = sessions.get(sessionId);
  if (record) {
    record.context = context;
    record.updatedAt = Date.now();
  }
}

// 向指定会话追加一轮查询，只保留最近 MAX_TURNS 轮。
export function appendTurn(
  sessionId: string,
  turn: IntentHistoryTurn
): void {
  const record = sessions.get(sessionId);
  if (!record) return;
  record.turns.push(turn);
  if (record.turns.length > MAX_TURNS) record.turns = record.turns.slice(-MAX_TURNS);
  record.updatedAt = Date.now();
}
