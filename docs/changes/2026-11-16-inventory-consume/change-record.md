# 付款时消费库存改动记录

- 日期：2026-11-16（Asia/Shanghai）
- 需求来源：用户确认“付款的时候需要加一个扣减库存”，并授权实现。

## 改动概要

付款创建订单时，在同一 MySQL/InnoDB 事务中锁定并校验订单对应的库存预留，原子减少 SKU 的 `on_hand` 与 `reserved`，将预留状态改为 `CONSUMED`，并写入 `inventory_reservation_events` 的消费事件。WEB 与 AI 下单共用该逻辑；幂等重试在库存消费前返回原订单，避免重复扣减。语言下拉、登录/退出按钮改为无边框样式，并删除重复购物车入口。

## 涉及文件

- `lib/order-service.ts`
- `db/migrations/009_consume_inventory_on_order.sql`
- `app/api/v1/carts/order/route.ts`
- `app/api/v1/assistant/order/route.ts`
- `lib/mcp/commerce-server.ts`
- `components/assistant-dock.tsx`
- `app/layout.tsx`
- `app/globals.css`
- `components/auth-provider.tsx`
- `components/language-provider.tsx`
- `app/account/orders/page.tsx`
- `app/orders/[orderGroupId]/page.tsx`
- `app/orders/[orderGroupId]/result/page.tsx`

## 验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm test`：通过。
- `git diff --check`：通过（Git 仅提示工作区 LF/CRLF 自动转换）。

## Review 结论与遗留风险

静态审查确认库存消费和订单写入共享事务，按稳定 SKU 顺序处理锁，幂等请求不会重复扣库存；过期、非 `ACTIVE` 或数量不匹配的预留会失败并回滚。当前未执行真实 MySQL 并发集成测试，因为环境没有可用数据库连接。
