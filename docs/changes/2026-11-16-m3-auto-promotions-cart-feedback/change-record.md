# M3 自动优惠与购物车反馈改动记录

## 改动概要

M3 报价改为服务端自动应用规则：普通 WEB 购物车按折前小计自动应用 A+B，AI 自动建单来源在 M4 接入后可在 A/B 基础上应用 C。移除购物车优惠选择器，首页加购补充成功动画和无障碍提示，头部购物车徽标实时显示商品数量。

## 改动原因

依据用户确认的优惠口径：优惠不可由普通购物车手选；A/B 满足条件时叠加；C 仅属于 AI 自动创建订单的 M4 场景。

## 改动文件

- `lib/pricing-domain.ts`
- `lib/cart-client.ts`
- `app/api/v1/carts/quote/route.ts`
- `app/cart/page.tsx`
- `app/page.tsx`
- `app/layout.tsx`
- `components/cart-count.tsx`
- `app/globals.css`
- `db/migrations/002_create_cart_inventory.sql`
- `scripts/m3-domain-check.ts`
- `docs/v0.1.0/backend-technical-design.md`
- `docs/v0.1.0/frontend-technical-design.md`
- `docs/v0.1.0/cases/2026-11-15-m3-inventory-pricing/m3-test-cases.md`

## 验证

- 时间：2026-11-16 Asia/Shanghai。
- 已通过：`npm run test:m3`、`npm run typecheck`、`npm run lint`、`npm test`（3 个测试文件、8 个测试通过）、`npm run build`、`git diff --check`。

## 遗留风险

- C 的可信 AI 来源证明和自动建单由 M4 实现；当前 WEB reconcile 不会获得 C。
- 95 折结果继续使用 `Math.round`，如需变更应新增规则版本和迁移。
