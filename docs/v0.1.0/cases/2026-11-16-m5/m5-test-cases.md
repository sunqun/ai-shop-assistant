# M5 AI 选品、购物车与独立下单测试用例

## 范围

覆盖 AI 来源购物车、库存锁定、报价绑定、登录与授权边界、MCP 工具校验、订单幂等和来源审计。真实数据库事务需要配置 MySQL；浏览器交互需要单独的 E2E 环境。

## 用例

| 编号 | 前置数据 | 操作 | 预期 | 关联 |
| --- | --- | --- | --- | --- |
| M5-T01 | 同一用户拥有 WEB 与 AI token | 用 AI token 选择 SKU 并 reconcile，再读取 WEB 购物车 | AI 购物车使用独立 `cart_id`、来源为 `AI`，WEB 购物车内容和版本不变化 | F-07、AC-04 |
| M5-T02 | AI 购物车有有效库存预留和报价 | 使购物车版本、预留或报价过期后提交订单 | 返回 409 `CART_CHANGED`、`CART_RESERVATION_EXPIRED` 或 `QUOTE_EXPIRED`，不创建订单 | F-07、F-10、AC-05 |
| M5-T03 | 用户未登录或 `is_authorized=false` | 调用 AI 下单接口 | 未登录返回 401；未授权返回 403 `AUTHORIZATION_REQUIRED`；两种情况均不建单 | F-10、AC-08 |
| M5-T04 | 已登录且 `is_authorized=true`，AI 购物车和报价有效 | 通过 MCP commerce tool 提交订单 | 创建 AI 来源订单记录，审计记录 `provenance=assistant`；不返回结算/履约状态，不执行支付或履约 | F-10、AC-12 |
| M5-T05 | 有效报价和幂等键 K | 重复提交相同 K；再用 K 提交不同购物车或报价 | 相同 K 返回首次完整回执且不重复建单；不同内容返回 `IDEMPOTENCY_KEY_REUSED` | F-10、AC-08 |
| M5-T06 | 任意合法会话 | 传入错误 token、版本、SKU、数量、quote UUID 或超长/非法幂等键 | MCP 返回 `MCP_INVALID_ARGUMENTS`，不访问交易服务 | 安全与接口契约 |
| M5-T07 | 有效 AI 报价 Q | 使用 Q 成功建单后再次使用 Q 但换幂等键 | 返回 409 `QUOTE_ALREADY_USED`，不创建第二个订单 | 报价消费一致性 |

## 执行记录

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm test`：通过，4 个测试文件、12 个测试通过。
- `npm run build`：通过，Next.js 生产构建完成。
- `git diff --check`：通过（仅报告 Git 的换行符转换提示）。
- M5-T01～M5-T07 的真实 MySQL 事务：未执行，当前环境未提供数据库连接配置；已完成代码路径和迁移契约检查。
- 浏览器助手交互：未执行，项目未配置 Playwright E2E。

## 遗留确认

- M6/M7 已确认本期不接入支付、不扣款、不实现物流、发货、收货、退货、退款或其他履约流程。
