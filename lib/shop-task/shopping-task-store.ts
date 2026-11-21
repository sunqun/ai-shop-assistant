/**
 * 购物任务（Shopping Task）持久化与状态迁移层。
 *
 * AI 购物流程被抽象为一个可推进、可取消、可恢复的"任务"，由本文件负责：
 *   - 任务的创建、读取、更新（所有状态迁移都在行锁事务内完成）
 *   - 数据库行记录（shopping_tasks）与领域对象（TaskRecord / ShoppingTask）的互转
 *   - 任务是否已过期（stale）、能否取消/确认/推进/恢复等能力位的计算
 *
 * 与 shopping-task-service.ts 的分工：本文件只做"存取与原子状态变更"，
 * 业务编排（准备、下单、取消）由 service 层调用这里提供的原语完成。
 */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/repository/db";
import { REVIEW_LEASE_MS } from "@/lib/reviews/types";
import {
  CANCELLABLE_PHASES,
  TERMINAL_PHASES,
  type ShoppingPhase,
  type ShoppingTask,
  type ShoppingTaskData,
} from "./shopping-task-types";

// 购物任务业务错误：附带业务错误码与 HTTP 状态码，供上层统一映射响应。
export class ShoppingTaskError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

// 数据库层任务记录（领域对象）：由 fromRow 从行数据构造，供业务逻辑读写。
export type TaskRecord = {
  taskId: string;
  userid: string;
  query: string;
  phase: ShoppingPhase;
  revision: number;
  data: ShoppingTaskData;
  commitAfter: string | null;
  operationToken: string | null;
  operationStartedAt: string | null;
  activeUser: string | null;
};

// 将数据库日期/字符串值统一转为 ISO 字符串；空值返回 null。
function timestamp(value: unknown): string | null {
  return value ? new Date(value as string | Date).toISOString() : null;
}

// 将 shopping_tasks 行记录转换为领域对象 TaskRecord。
function fromRow(row: RowDataPacket): TaskRecord {
  return {
    taskId: String(row.task_id),
    userid: String(row.userid),
    query: String(row.query_text),
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

// 将领域对象 TaskRecord 转换为返回给前端的 ShoppingTask 视图，
// 并基于当前 phase / operationToken / 是否过期计算前端可执行的操作能力位。
// 常情况下按阶段推进；卡死了也能推进恢复；但如果正因「看评论」暂缓自动下单，就按住不让走
export function taskView(task: TaskRecord): ShoppingTask {
  const stale = isOperationStale(task);
  const { reviewProgress, ...publicData } = task.data;
  const reviewBusy = !!(
    reviewProgress?.operationToken &&
    reviewProgress.operationStartedAt &&
    Date.now() - Date.parse(reviewProgress.operationStartedAt) < REVIEW_LEASE_MS
  );
  return {
    ...publicData,
    taskId: task.taskId,
    query: task.query,
    phase: task.phase,
    revision: task.revision,
    commitAfter: task.commitAfter,
    canCancel: CANCELLABLE_PHASES.includes(task.phase),
    canConfirm:
      task.phase === "awaiting_confirmation" &&
      !!task.data.product &&
      !!task.data.quote &&
      !task.operationToken,
    canAdvance:
      !(task.data.reviewHold && task.phase === "ready_to_order") &&
      ((!task.operationToken &&
        ["queued", "ready_to_order", "cancel_pending"].includes(task.phase)) ||
        (stale && !["committing", "reconciling_result"].includes(task.phase))),
    canRecover:
      task.phase === "reconciling_result" ||
      (task.phase === "committing" && stale),
    terminal: TERMINAL_PHASES.includes(task.phase),
    canResumeAfterReviews:
      !!task.data.reviewHold &&
      CANCELLABLE_PHASES.includes(task.phase) &&
      !reviewBusy,
  };
}

// 判断一次正在执行的操作是否已过期：存在操作令牌、有开始时间，且超过 120 秒。
export function isOperationStale(task: TaskRecord): boolean {
  return (
    !!task.operationToken &&
    !!task.operationStartedAt &&
    Date.now() - Date.parse(task.operationStartedAt) > 120_000
  );
}

// 按 userid + taskId 读取单个任务；不存在则抛 404。
export async function getTask(
  userid: string,
  taskId: string,
): Promise<TaskRecord> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT * FROM shopping_tasks WHERE task_id = ? AND userid = ?",
    [taskId, userid],
  );
  if (!rows[0])
    throw new ShoppingTaskError("TASK_NOT_FOUND", "购物任务不存在。", 404);
  return fromRow(rows[0]);
}

// 读取用户当前占用的活跃任务（按 active_user 匹配）；没有则返回 null。
export async function getActiveTask(
  userid: string,
): Promise<TaskRecord | null> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT * FROM shopping_tasks WHERE active_user = ?",
    [userid],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** 所有状态迁移在持有同一任务行锁时执行；事务内禁止调用模型/业务工具。 */
export async function updateTask(
  userid: string,
  taskId: string,
  change: (task: TaskRecord) => void,
): Promise<TaskRecord> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    // FOR UPDATE 锁定任务行，保证同一任务的并发状态迁移串行化。
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM shopping_tasks WHERE task_id = ? AND userid = ? FOR UPDATE",
      [taskId, userid],
    );
    if (!rows[0])
      throw new ShoppingTaskError("TASK_NOT_FOUND", "购物任务不存在。", 404);
    const task = fromRow(rows[0]);
    // 由调用方传入的变更函数在内存中修改任务，随后统一落库。
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
        // 终态任务不再占用 active_user，避免阻塞后续任务。
        TERMINAL_PHASES.includes(task.phase) ? null : task.activeUser,
        taskId,
      ],
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

// 创建购物任务（幂等）：按 request_key 去重，同一请求键重复调用返回已存在任务。
export async function createTask(input: {
  userid: string;
  query: string;
  idempotencyKey: string;
  data?: ShoppingTaskData;
}): Promise<TaskRecord> {
  const pool = getDbPool();
  try {
    await pool.execute(
      `INSERT INTO shopping_tasks (task_id, userid, request_key, query_text, data_json, active_user)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.userid,
        input.idempotencyKey,
        input.query,
        JSON.stringify(input.data ?? {}),
        input.userid,
      ],
    );
  } catch (error) {
    // request_key 唯一冲突时忽略，走下方按 request_key 读取已存在任务的幂等路径。
    if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM shopping_tasks WHERE userid = ? AND request_key = ?",
    [input.userid, input.idempotencyKey],
  );
  if (!rows[0])
    throw new ShoppingTaskError(
      "ACTIVE_TASK_EXISTS",
      "已有购物任务正在执行，请先完成或取消当前任务。",
    );
  const task = fromRow(rows[0]);
  // 同一请求键若对应不同需求，判定为幂等键复用错误。
  if (task.query !== input.query)
    throw new ShoppingTaskError(
      "IDEMPOTENCY_KEY_REUSED",
      "同一请求标识不能用于不同购物需求。",
    );
  return task;
}

/** 独立交易入口不能跳过购物任务的取消/提交屏障。 */
export async function assertNotTaskQuote(
  userid: string,
  quoteId: string,
): Promise<void> {
  // 若该报价属于某个购物任务，则禁止绕过任务直接下单，必须走任务确认流程。
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT task_id FROM shopping_tasks WHERE userid = ? AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.quote.quote.quoteId')) = ? LIMIT 1",
    [userid, quoteId],
  );
  if (rows.length)
    throw new ShoppingTaskError(
      "TASK_CONFIRM_REQUIRED",
      "请通过当前购物任务确认订单。",
    );
}
