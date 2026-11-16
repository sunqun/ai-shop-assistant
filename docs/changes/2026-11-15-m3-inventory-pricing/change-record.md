# M3 购物车库存与最优报价改动记录

## 改动概要

完成 M3 购物车库存锁定、部分缺货拆分、重复请求幂等、过期预留释放、服务端最优报价和 `/cart` 优惠选择交互。报价按折前小计判断门槛，A/B/C 互斥，免运按整购物车计算；WEB 购物车不允许 AI 专属 C 方案。

## 改动原因

依据 `docs/v0.1.0/module-delivery-splitting.md` 的 M3 任务和已确认的 A/B/C 促销口径，覆盖 `F-07`～`F-09`、`AC-05`～`AC-07`。

## 改动文件

- `lib/inventory-domain.ts`
- `lib/pricing-domain.ts`
- `lib/cart-session.ts`
- `lib/cart-client.ts`
- `app/api/v1/carts/reconcile/route.ts`
- `app/api/v1/carts/quote/route.ts`
- `app/api/internal/inventory/expire/route.ts`
- `app/cart/page.tsx`
- `db/migrations/002_create_cart_inventory.sql`
- `scripts/m3-domain-check.ts`
- `package.json`
- `docs/v0.1.0/backend-technical-design.md`
- `docs/v0.1.0/frontend-technical-design.md`
- `docs/v0.1.0/cases/2026-11-15-m3-inventory-pricing/m3-test-cases.md`

## 验证

- 时间：2026-11-15 Asia/Shanghai。
- `npm run test:m3`：通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm test`：通过（3 个测试文件、8 个测试）。
- `npm run build`：通过（Next.js 生产构建成功，包含 M3 API 路由）。
- `git diff --check`：通过。
- MySQL API 集成、并发抢库存、定时释放和 Playwright E2E：未执行，环境未提供 MySQL/Playwright。

## Code review 结论

审查重点覆盖库存锁顺序、过期释放、幂等 payload hash、cart token、服务端报价、报价版本和页面金额来源。已补充过期预留批处理、事务内过期清理、输入对象校验、定价输入边界、报价到期恢复，以及报价前 ACTIVE 预留和数量一致性校验；库存归还和预留状态更新均检查数据库影响行数。复查未发现未处理的可确认问题。

## 遗留风险

- 002 迁移文件新增了 `cart_quotes`；若环境已经执行过早期版本的 002，需要单独补充等价的 schema migration 后再部署。
- 95 折最终舍入策略仍为 `needs_human_review`，当前实现使用 `Math.round`。
- M5 尚未实现建单，因此 quoteId 消费和旧报价在真实建单入口的最终阻断仍需由 M5 集成测试确认。
