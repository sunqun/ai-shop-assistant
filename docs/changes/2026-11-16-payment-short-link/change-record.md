# 支付短链改动记录

## 改动概要

在 AI 助手商品卡的“付款”后增加“生成支付短链”。生成操作要求登录，登录成功后自动重试；短链绑定创建者、商品和数量，在成功下单前长期有效，助手顶部提供复制、打开和删除。公开短链页无需登录即可读取订单信息，下单前要求输入支付密码；成功下单后短链立即软删除并失效，避免重复下单；当前只保留非空输入交互，不核验密码正确性。

## 需求来源

用户确认的支付短链流程：使用当前登录信息创建和归属短链；访问者不论是否登录都可打开；提交订单前输入支付密码；继续沿用创建者身份执行现有 AI 购物车、报价、订单和库存逻辑。

## 修改文件

- `db/migrations/010_create_payment_links.sql`
- `lib/payment-link-service.ts`
- `lib/payment-link-client.ts`
- `app/api/v1/assistant/payment-links/route.ts`
- `app/api/v1/assistant/payment-links/[linkId]/route.ts`
- `app/api/v1/handoff/[token]/route.ts`
- `components/assistant-dock.tsx`
- `components/auth-provider.tsx`
- `app/handoff/[token]/page.tsx`
- `app/globals.css`

## 时间

2026-11-16 Asia/Shanghai

## 验证

- `npm run typecheck`：通过
- `npm run lint`：通过
- `npm test`：通过，7 个测试文件、18 个测试
- `git diff --check`：通过

## Code review 结论

已检查创建权限、短链 bearer token 查询、删除归属校验、支付密码非空门槛、创建者身份下单、库存失败映射和现有登录重试链路。未发现需要阻止交付的代码问题。

## 遗留风险

- 支付密码目前只校验非空和格式，不核对真实密码。
- 现有“付款”操作仍按项目现有逻辑建立订单，不接入真实支付渠道。
- 创建者未完成现有授权时，短链下单会被现有订单服务拒绝。
- 未成功下单前短链是 bearer token，获得链接即可访问其商品摘要并尝试下单；成功下单后服务端软删除短链并拒绝再次访问，用户手动删除仍沿用软删除。
- 需要在目标数据库执行 `010_create_payment_links.sql` 后，短链接口才能读写数据。
