# AI 商城

基于 Next.js App Router 的桌面网页商城，内置 AI 搜索助手与 AI 购物对话页。用户可浏览/搜索商品、查看详情与评论、维护购物车并结账创建订单记录；本期不接入真实支付、物流、发货、退款或售后。

## 功能概览

- 商品：分类/关键词筛选、推荐/评分/价格排序、服务端分页、详情与公开脱敏评论。
- 普通购物车：加购、改量、移除、库存分配、勾选结算与报价。
- AI 助手：首页搜索助手（自然语言查商品/规格/库存）与 `/assistant` 购物对话页（手动确认 / 自动下单两种模式）。
- 库存与报价：24 小时库存预留、统一优惠计价（满减 A / 免运 B / AI 折扣 C）。
- 交接短链：登录用户生成单商品短链，可匿名查看并结账。
- 订单：创建订单记录并查询本人订单；建单需登录且显式授权。

## 技术栈

- Next.js 15（App Router）、React 19、TypeScript
- HTTP 后端由同一应用的 Route Handlers 承载（Node.js 运行时）
- MySQL / mysql2、Zod 参数校验
- 测试：Vitest + Testing Library；CI 使用 Node.js 22

## 快速开始

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 本地开发服务 |
| `npm run typecheck` | TypeScript 静态检查 |
| `npm run lint` | ESLint 检查 |
| `npm test` | Vitest 单次执行 |
| `npm run build` | 生产构建 |

## 环境变量

订单记录写入 MySQL，需先按 `db/migrations/` 初始化数据库。生产环境至少需要 `AUTH_SESSION_SECRET`，以及以下任一组 MySQL 连接变量：

- `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`
- Railway 默认变量 `MYSQLHOST`、`MYSQLPORT`、`MYSQLDATABASE`、`MYSQLUSER`、`MYSQLPASSWORD`
- `MYSQL_URL` 或 `DATABASE_URL`（格式为 `mysql://用户名:密码@主机:端口/数据库名`）

应用优先读取带下划线的变量，其次读取 Railway 变量和连接 URL。`users` 表未初始化时注册接口返回 503；部署后请确认已执行 `db/migrations/` 下全部迁移（先执行 `002_create_products.sql`，再执行 `003_create_categories.sql`）。

## 项目结构

| 位置 | 职责 |
| --- | --- |
| `app/` | 页面、页面组件、客户端状态与 `api.ts` 请求封装 |
| `app/api/v1/` | HTTP 边界：登录态、参数校验、调用业务服务、错误码与响应 |
| `components/` | 跨页面组件、登录/语言/提示 Provider、首页商品组件与助手 Dock |
| `lib/auth/` | 认证、密码、会话、用户数据与登录重试封装 |
| `lib/catalog/` | 商品目录、查询分页、规格核实、推荐排序、公开评论读取 |
| `lib/intent/` | 统一意图路由、结构化抽取、上下文补槽、条件合并/撤销与数值校验 |
| `lib/agent/` | 搜索/对话编排、工具注册、搜索会话、受控购物 ReAct |
| `lib/llm/` | 模型客户端、配置、结构化工具调用、错误/重试与通用 ReAct |
| `lib/mcp/` | 目录/交易/交接链接工具契约与转发（当前为进程内调用） |
| `lib/shop-task/` | 购物任务类型、存储、状态机编排与任务 HTTP 辅助 |
| `lib/repository/` | 数据库连接池、购物车、报价、订单、优惠资格及交接链接服务 |
| `lib/pricing-domain.ts` | 唯一价格规则实现与金额转换/小计 |
| `lib/inventory-domain.ts` | 库存请求归一化与可分配数量计算 |
| `lib/reviews/` | 评论分批分析、报告归纳与进度快照 |
| `lib/cart-client/` | 网页购物车请求与客户端操作封装 |
| `db/` | 数据库结构与增量迁移 |
| `testLibrary/` | 自动化用例（`auth` / `domain` / `intent` / `ommerce`） |

## 文档导航

- 初始需求与设计：[`docs/v0.1.0/`](docs/v0.1.0/)（需求分析、前后端技术设计、模块拆分）
- 当前实现方案：[`docs/v0.1-current/`](docs/v0.1-current/)（需求功能清单、前端/后端技术文档）
- 交付材料：[`delivery-docs/`](delivery-docs/)（决策记录 `DECISIONS.md`、CI 与计价验证 `GitHub_Actions.md`、AI 协作记录 `AI_NOTES.md`）

## 范围与边界

- 仅桌面浏览器网页，不包含手机/平板适配。
- 未接入真实支付渠道；“付款”仅创建并持久化订单记录，不扣款、不发货、不退款。
- 第三方 AI 助理远程接入未实现；现有工具为进程内调用。
- 部分业务规则尚未最终确认，标记为 `needs_human_review`，详见 [`delivery-docs/DECISIONS.md`](delivery-docs/DECISIONS.md)。

## 单一对话下单流程（v0.2）

当前 AI 对话统一自动下单，有商品差异时展示差异与完整报价并等待用户接受。当前对话任务（包括中途确认）享有优惠 C；独立网页或短链提交不因此获得资格。运行前按升级要求应用 `db/migrations/015_unified_conversation_tasks.sql`，该文件生成不代表已经执行。详见 [`docs/v0.2-unified-shopping/`](docs/v0.2-unified-shopping/requirements-list.md)。
