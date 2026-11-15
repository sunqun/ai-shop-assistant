# M1 注册功能改动记录

- 改动时间：2026-11-15（Asia/Shanghai）
- 需求来源：用户要求在现有首页登录弹窗中增加注册功能，并同步修改需求文档后实现代码。

## 改动概要

- 首页登录弹窗增加登录/注册模式切换。
- 新增 `POST /api/v1/auth/register`，使用服务端 UUID、唯一用户名、scrypt 密码哈希和默认未授权字段创建用户。
- 注册成功直接建立网页 session；用户名冲突返回 409；登录失败不自动注册。
- 更新需求、前端、后端和模块拆分文档，并新增 M1 注册测试用例。

## 文件清单

- `app/api/v1/auth/register/route.ts`
- `components/auth-provider.tsx`
- `lib/user-repository.ts`
- `app/globals.css`
- `docs/v0.1.0/requirements-analysis.md`
- `docs/v0.1.0/frontend-technical-design.md`
- `docs/v0.1.0/backend-technical-design.md`
- `docs/v0.1.0/module-delivery-splitting.md`
- `docs/v0.1.0/cases/2026-11-15-m1-registration/m1-registration-test-cases.md`

## 验证

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `git diff --check`：通过（仅报告现有工作树的换行转换提示）。
- API 合法注册、短密码、重复用户名和注册后 session：通过。

## Code review 结论

按认证调用链检查输入校验、唯一约束、session 建立、默认授权值、错误码和前端失败状态；未发现需要阻断交付的有效问题。

## 遗留风险

- 尚未实现密码复杂度、找回密码、邮箱/手机验证、注册限流和注销，这些规则在需求中仍为 `needs_human_review`。
- 本次未执行浏览器自动化视觉回归；后续可用 Playwright 验证弹窗模式切换和失败保留状态。
