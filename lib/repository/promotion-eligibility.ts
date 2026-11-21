import type { PoolConnection, RowDataPacket } from "mysql2/promise";

// 调用方先锁定 users 行，同一账号的 WEB/AI 下单串行核销 A。
// 成功订单及其报价就是核销记录；历史订单也纳入，失败事务不会消耗资格。
export async function promotionAAvailable(connection: PoolConnection, userid: string) {
  const [used] = await connection.query<RowDataPacket[]>(
    `SELECT og.order_group_id FROM order_groups og
      INNER JOIN cart_quotes q ON q.quote_id = og.quote_id
      WHERE og.userid = ? AND q.promotion IN ('A+B', 'A+B+C')
        AND q.consumed_at IS NOT NULL LIMIT 1`,
    [userid]
  );
  return used.length === 0;
}

// taskId 仅由服务端任务编排传入，不接受客户端或模型声明“享受 C”。
export async function isAutoShoppingTask(connection: PoolConnection, userid: string, taskId?: string | null) {
  if (!taskId) return false;
  const [tasks] = await connection.query<RowDataPacket[]>(
    "SELECT task_id FROM shopping_tasks WHERE task_id = ? AND userid = ? AND mode = 'auto'",
    [taskId, userid]
  );
  return tasks.length === 1;
}
