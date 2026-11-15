# M1 身份与授权实现改动记录

## 改动概要

实现首页登录弹窗、会话接口、用户授权接口、MySQL `users` 表迁移，以及“我的”中的 AI 自助下单授权入口。独立 `/login` 和旧的授权管理页保留为兼容入口并重定向到首页或“我的”。

## 需求来源

依据 `docs/v0.1.0/requirements-analysis.md`、`frontend-technical-design.md`、`backend-technical-design.md` 和 `module-delivery-splitting.md` 中已确认的 M1 范围。

## 改动文件

- `components/auth-provider.tsx`
- `app/layout.tsx`
- `app/account/page.tsx`
- `app/login/page.tsx`
- `app/account/authorizations/page.tsx`
- `app/api/v1/auth/login/route.ts`
- `app/api/v1/auth/session/route.ts`
- `app/api/v1/auth/logout/route.ts`
- `app/api/v1/me/authorization/route.ts`
- `lib/db.ts`
- `lib/user-repository.ts`
- `lib/password.ts`
- `lib/auth-server.ts`
- `db/migrations/001_create_users.sql`
- `.env.example`
- `package.json`、`package-lock.json`
- `app/globals.css`、`app/page.tsx`

## 验证

- `npm run typecheck`：通过
- `npm run build`：通过
- `git diff --check`：通过（仅有 Git 的换行符提示）
- 测试用例：`docs/v0.1.0/cases/2026-11-15-m1-auth/m1-auth-test-cases.md`

## Code review 结论

已按 `code-review` skill 对本次实际差异和认证调用链进行只读审查，未发现可确认的 P0/P1/P2 问题。密码只以 scrypt 哈希校验，会话使用 HttpOnly、SameSite=Lax 签名 Cookie，授权接口要求有效会话并只允许 `false -> true`。

## 遗留风险与限制

- 尚未使用真实本地 MySQL 执行迁移和登录/授权写入验证，需要补充测试用户。
- 本阶段不实现注册、授权撤销/更新、支付代扣凭证、Agent/OAuth 或订单创建接口。
- 生产环境必须配置高强度 `AUTH_SESSION_SECRET`，并通过环境变量提供 MySQL 连接信息。
