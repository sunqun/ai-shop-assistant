# M5 AI 选品与独立下单改动记录

## 改动概要

实现 AI 购物车、库存预留与报价调用、独立 AI 下单和 MCP commerce 工具封装。AI 与 WEB 购物车通过来源派生不同会话空间；订单由服务端 session 用户和授权字段校验，响应记录 AI provenance。报价绑定购物车版本并在成功建单后消费，订单回执按幂等键持久化。

## 需求来源

依据 `docs/v0.1.0/module-delivery-splitting.md` 的 M5：M4 选择商品后创建 AI 来源购物车，复用 M3 库存/报价契约，校验 M1 登录授权，通过可信来源创建订单并记录审计。

## 改动文件

- `lib/cart-service.ts`
- `lib/quote-service.ts`
- `lib/order-service.ts`
- `lib/cart-session.ts`
- `lib/mcp/types.ts`
- `lib/mcp/commerce-server.ts`
- `lib/mcp/client.ts`
- `lib/ai-cart-client.ts`
- `lib/agent/tool-registry.ts`
- `app/api/v1/assistant/cart/reconcile/route.ts`
- `app/api/v1/assistant/cart/quote/route.ts`
- `app/api/v1/assistant/order/route.ts`
- `app/api/v1/carts/reconcile/route.ts`
- `app/api/v1/carts/quote/route.ts`
- `db/migrations/002_create_cart_inventory.sql`
- `db/migrations/006_create_orders.sql`
- `components/assistant-dock.tsx`
- `app/globals.css`
- `docs/v0.1.0/cases/2026-11-16-m5/m5-test-cases.md`

## 验证

- 时间：2026-11-16 Asia/Shanghai。
- 已通过：`npm run typecheck`、`npm run lint`、`npm test`（4 个测试文件、12 个测试通过）、`npm run build`、`git diff --check`。
- 未执行：真实 MySQL/API 集成和浏览器 E2E，原因是当前环境未配置 MySQL/Playwright。

## Code review 结论

已按 `code-review` 规则检查本次差异和相关调用链，并处理商品表依赖、MCP 输入边界、未知工具名、订单授权事务竞态、quote 重复消费、幂等响应不完整和用户外键等问题。MCP commerce 工具继续由 Agent 注册表统一暴露，API 路由通过 MCP client 调用，不直接访问交易服务。

## 已知限制与 needs_human_review

- 订单价格使用仓库现有 `lib/products.ts` 可信目录；数据库 `products` 表不在当前迁移集合中，后续若引入商品数据库需定义迁移和价格快照契约。
- 支付、收货后扣款、缺货项后续履约和代扣授权仍为 `needs_human_review`，本模块不发起扣款。
- `cart-v2` 会话派生使旧 token 不再访问新来源空间；上线前需按部署策略决定旧 token 迁移或自然失效窗口。
