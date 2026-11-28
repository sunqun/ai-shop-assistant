# 决策记录：登录与注册设计

## 标题

登录与注册设计（账号存储、密码哈希、会话建立与输入校验）

## 日期

2026-11-28

## 版本号

v1

## 背景

商城面向网页端与 AI agent（MCP）两类调用方，需要账号体系支持登录/注册，为后续购物、下单与授权提供身份基础。登录/注册成功需建立会话，供后续请求识别用户。

## 决定

**账号存储**
- 用户存 MySQL `users` 表，字段 `userid`(UUID)、`username`、`password_hash`、`is_authorized`；`username` 唯一。
- 用户名最大 191 字符，密码长度 8~128。

**密码**
- 使用 scrypt 哈希存储，格式 `scrypt$盐$密钥`，盐 16 字节、密钥 64 字节。
- 校验用 `timingSafeEqual` 常量时间比较，避免时序侧信道。

**注册**
- `POST /api/v1/auth/register`：校验用户名非空、密码 8~128、`confirmPassword` 一致后创建用户。
- 注册默认 `is_authorized = false`，不自动授权 AI 自助下单。
- 成功即建立会话并返回用户信息。

**登录**
- `POST /api/v1/auth/login`：按用户名查用户，`verifyPassword` 校验密码。
- 凭据错误返回 `INVALID_CREDENTIALS`(400)，不区分用户名不存在与密码错误。
- 可携带 `authorizationConsent: true` 一次性授权；成功即建立会话。

**会话**
- 会话为无状态签名 cookie `ai_shop_session`，HMAC-SHA256 签名，payload 为 `{ userid, exp }`，有效期 7 天。
- `httpOnly`、`sameSite=lax`、生产环境 `secure`；用户身份一律取自服务端会话。

**退出**
- `POST /api/v1/auth/logout` 清除会话 cookie。

**MCP 侧登录**
- `shop_login` 调用商城 `/auth/login` 或 `/auth/register`，从 `set-cookie` 提取 `ai_shop_session`，存入内存 `ServerConfigManager`，按 MCP sessionId 隔离。
