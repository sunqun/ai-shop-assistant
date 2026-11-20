import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db";
import {
  CANCELLABLE_PHASES,
  TERMINAL_PHASES,
  type ShoppingMode,
  type ShoppingPhase,
  type ShoppingTask,
  type ShoppingTaskData,
} from "./shopping-task-types";

export class ShoppingTaskError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409
  ) {
    super(message);
  }
}

export type TaskRecord = {
  taskId: string;
  userid: string;
  query: string;
  mode: ShoppingMode;
  phase: ShoppingPhase;
  revision: number;
  data: ShoppingTaskData;
  commitAfter: string | null;
  operationToken: string | null;
  operationStartedAt: string | null;
  activeUser: string | null;
};

function timestamp(value: unknown): string | null {
  return value ? new Date(value as string | Date).toISOString() : null;
}

function fromRow(row: RowDataPacket): TaskRecord {
  return {
    taskId: String(row.task_id),
    userid: String(row.userid),
    query: String(row.query_text),
    mode: row.mode as ShoppingMode,
    phase: row.phase as ShoppingPhase,
    revision: Number(row.revision),
    data: (typeof row.data_json === "string"
      ? JSON.parse(row.data_json)
      : row.data_json) as ShoppingTaskData,
    commitAfter: timestamp(row.commit_after),
    operationToken: row.operation_token ?? null,
    operationStartedAt: timestamp(row.operation_started_at),
    activeUser: row.active_user ?? null,
  };
}

export function taskView(task: TaskRecord): ShoppingTask {
  const stale = isOperationStale(task);
  return {
    ...task.data,
    taskId: task.taskId,
    query: task.query,
    mode: task.mode,
    phase: task.phase,
    revision: task.revision,
    commitAfter: task.commitAfter,
    canCancel: CANCELLABLE_PHASES.includes(task.phase),
    canConfirm: task.phase === "awaiting_confirmation" && !task.operationToken,
    canAdvance:
      (!task.operationToken &&
        ["queued", "ready_to_order", "cancel_pending"].includes(task.phase)) ||
      (stale && !["committing", "reconciling_result"].includes(task.phase)),
    canRecover: task.phase === "reconciling_result" || (task.phase === "committing" && stale),
    terminal: TERMINAL_PHASES.includes(task.phase),
  };
}

export function isOperationStale(task: TaskRecord): boolean {
  return (
    !!task.operationToken &&
    !!task.operationStartedAt &&
    Date.now() - Date.parse(task.operationStartedAt) > 120_000
  );
}

export async function getTask(userid: string, taskId: string): Promise<TaskRecord> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT * FROM shopping_tasks WHERE task_id = ? AND userid = ?",
    [taskId, userid]
  );
  if (!rows[0]) throw new ShoppingTaskError("TASK_NOT_FOUND", "购物任务不存在。", 404);
  return fromRow(rows[0]);
}

export async function getActiveTask(userid: string): Promise<TaskRecord | null> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT * FROM shopping_tasks WHERE active_user = ?",
    [userid]
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** 所有状态迁移在持有同一任务行锁时执行；事务内禁止调用模型/业务工具。 */
export async function updateTask(
  userid: string,
  taskId: string,
  change: (task: TaskRecord) => void
): Promise<TaskRecord> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM shopping_tasks WHERE task_id = ? AND userid = ? FOR UPDATE",
      [taskId, userid]
    );
    if (!rows[0]) throw new ShoppingTaskError("TASK_NOT_FOUND", "购物任务不存在。", 404);
    const task = fromRow(rows[0]);
    change(task);
    task.revision += 1;
    await connection.execute(
      `UPDATE shopping_tasks SET phase = ?, revision = ?, data_json = ?, commit_after = ?,
       operation_token = ?, operation_started_at = ?, active_user = ? WHERE task_id = ?`,
      [
        task.phase,
        task.revision,
        JSON.stringify(task.data),
        task.commitAfter ? new Date(task.commitAfter) : null,
        task.operationToken,
        task.operationStartedAt ? new Date(task.operationStartedAt) : null,
        TERMINAL_PHASES.includes(task.phase) ? null : task.activeUser,
        taskId,
      ]
    );
    await connection.commit();
    return task;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createTask(input: {
  userid: string;
  query: string;
  mode: ShoppingMode;
  idempotencyKey: string;
}): Promise<TaskRecord> {
  const pool = getDbPool();
  try {
    await pool.execute(
      `INSERT INTO shopping_tasks (task_id, userid, request_key, mode, query_text, data_json, active_user)
       VALUES (?, ?, ?, ?, ?, '{}', ?)`,
      [randomUUID(), input.userid, input.idempotencyKey, input.mode, input.query, input.userid]
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM shopping_tasks WHERE userid = ? AND request_key = ?",
    [input.userid, input.idempotencyKey]
  );
  if (!rows[0])
    throw new ShoppingTaskError(
      "ACTIVE_TASK_EXISTS",
      "已有购物任务正在执行，请先完成或取消当前任务。"
    );
  const task = fromRow(rows[0]);
  if (task.query !== input.query || task.mode !== input.mode)
    throw new ShoppingTaskError("IDEMPOTENCY_KEY_REUSED", "同一请求标识不能用于不同购物需求。");
  return task;
}

/** 独立交易入口不能跳过购物任务的取消/提交屏障。 */
export async function assertNotTaskQuote(userid: string, quoteId: string): Promise<void> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT task_id FROM shopping_tasks WHERE userid = ? AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.quote.quote.quoteId')) = ? LIMIT 1",
    [userid, quoteId]
  );
  if (rows.length)
    throw new ShoppingTaskError("TASK_CONFIRM_REQUIRED", "请通过当前购物任务确认订单。");
}
