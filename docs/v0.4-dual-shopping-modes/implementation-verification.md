# 双模式购物流程实现与验证

日期：2026-11-20。

当前调用关系与状态分支见[两个助手的当前流程图](assistant-entry-flow.md)；v0.3 下的原流程图已标记为历史版本。

## 实现位置

- 任务数据契约：`lib/agent/shopping-task-types.ts`。
- 数据库存储与事务锁：`lib/agent/shopping-task-store.ts`。
- 准备、取消、提交、恢复和短链分支：`lib/agent/shopping-task-service.ts`。
- 复用的 ReAct 准备与真实工具前置检查：`lib/agent/auto-shopping.ts`。
- API：`app/api/v1/assistant/tasks/`；提供创建/恢复活动任务、查询和 advance/cancel/confirm/retry-link/recover 动作。
- 页面交互：`app/assistant/api.ts`、`use-assistant.ts`、composer/messages/workflow 组件。
- 数据库：`db/migrations/011_create_shopping_tasks.sql`；部署其他环境时先应用此迁移，不会在请求中自动建表。

## 自动化验证

本地执行结果：`npm run typecheck`、`npm run lint`、`npm run build` 均通过；常规测试 55 项通过，另有 12 项真实数据库集成测试单独启用并全部通过。HTTP 校验 11 项通过。

- 常规测试包含 ReAct 工具准备、手动确认/自动倒计时、忙碌时取消、创建阶段隐藏取消、未知订单结果恢复、刷新任务后暂停推进等场景。
- `shopping-tasks.integration.test.ts` 使用真实 MySQL 事务锁，模拟业务工具：覆盖取消与提交并发、重复创建、所有者隔离、提前取消、搜索期间取消、短链失败重试、稳定订单幂等键、旧接口绕过检查和中断恢复。
- 数据库集成测试需显式设置 `SHOPPING_TASK_DB_TEST=1` 执行；默认常规测试跳过该文件。测试仅创建临时测试用户与任务记录并清理，不创建真实订单、不预留真实商品库存。
- 本地 HTTP 验证覆盖：未登录 401、创建 202、重复创建复用任务、跨用户访问 404、授权不足 403、旧 ReAct 与活动任务冲突 409、旧下单入口无法提交任务报价、取消后不可继续推进，以及首页/助手页 200。
- 桌面浏览器检查 1280×900 下的模式区、流程栏、消息区和输入区；无横向溢出，输入操作区位于窗口可视范围内。

## 演示步骤

1. 使用已完成既有 AI 下单授权的演示账号进入 `/assistant`。
2. 选择“确认后下单”，发送商品需求；报价后点击确认，或点击取消并生成短链。
3. 选择“自动下单”，发送商品需求；报价展示约 3 秒后自动创建订单。
4. 在创建开始前取消，观察停止下单和生成短链；进入创建订单后，取消按钮隐藏。
5. 执行期间刷新，任务恢复但自动推进暂停；点击继续执行后恢复。若订单结果不确定，使用“核对订单结果”，不要重新发送同一购买请求。

未确认的库存清理、授权范围扩展、费用承诺和任务保留规则仍按需求文档的 `needs_human_review` 管理。
