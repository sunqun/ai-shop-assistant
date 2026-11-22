# 全链路与数据库结构自检记录

日期：2026-11-22（Asia/Shanghai）。源码基线：HEAD `eab61f6` 加本次检查时的未提交工作区。采用 `shop-pricing-audit` v0.2.0 的调用链与证据分级方法，并扩展到认证、目录、库存和购物任务。既有未提交修改保持原样。

## 1. 结论与边界

- **当前项目配置连接的是本地 `ai_shop`，MySQL 8.0.46；本次结论不等同于线上部署库验收。**
- `db/ddl.sql` 的 18 张表、132 个字段均存在于该库，字段类型和可空性一致。未发现缺表、缺字段、额外必填无默认值字段。
- DDL 要求的 39 个索引和 18 个外键，名称、列顺序及索引唯一性/外键引用关系均核对通过；4 个具名 CHECK 约束均存在。CHECK 表达式、外键删除/更新动作未在本次自动比对中逐字校验。
- 源码显式 INSERT 未发现漏写实际库必填列。默认值比较中，`margin_rate` 的 `0`/`0.0000`、`recommendation_score` 的 `0`/`0.00` 经人工复核属于数值格式差异。
- **字段完整不代表交易链路无问题。** 本次仍发现 JSON 幂等回放、连接池使用、短链事务和幂等键长度等问题，见第 4 节。
- 未修改业务代码、DDL、种子、依赖或测试文件；未新增或执行测试，未运行构建、模型或交易 API，未执行真实建单。

## 2. 实际检查方法与结果

读取当前 Next.js 开发环境配置，复用 `lib/repository/db.ts` 的 `getDbPool()`，在 `START TRANSACTION READ ONLY` 中查询 `information_schema.TABLES`、`COLUMNS`、`STATISTICS`、`KEY_COLUMN_USAGE`、`TABLE_CONSTRAINTS` 和 `CHECK_CONSTRAINTS`，检查结束后 ROLLBACK 并关闭连接。未查询任何业务表数据行，未输出账号、密码或连接 URL。

静态 SQL 审计以 TypeScript AST 读取 `app/`、`lib/` 共 127 个源文件，识别到 94 个带字面量/模板 SQL 的 query/execute 调用点，覆盖全部 18 张业务表；核对了 66 项限定列引用和 80 个可静态确定的 SQL 占位符/实参数组绑定，均未发现缺列或参数数量不一致。动态 WHERE、游标、排序、IN 列表和共用 SELECT/GROUP 片段结合源码人工核对；静态扫描不等同于执行 SQL。

| 检查项 | 结果 | 证据性质 |
| --- | --- | --- |
| 实际库与 DDL 的表/字段对比 | 18 表、132 字段，无缺失或额外列 | 实际只读元数据 |
| 字段类型、可空性、默认值 | 一致；两处小数默认值格式差异已人工复核 | 实际元数据 + 人工复核 |
| 索引、外键、CHECK 存在性 | DDL 要求均存在，见上文比对范围 | 实际只读元数据 |
| INSERT 必填列兼容性 | 未发现遗漏 | 实际字段元数据 + 源码 AST |
| SQL 表名、限定列和静态占位符 | 未发现不一致 | 静态分析 |
| `npm run typecheck -- --incremental false` | 通过，退出码 0 | 实际静态检查执行 |
| `npm run lint` | 退出码 0，0 error、1 warning：`components/assistant-docker/index.tsx:21` 的 `Sparkles` 未使用 | 实际静态检查执行 |
| 单元/集成/端到端测试、并发压测、构建 | 按用户要求未执行 | 未验证 |
| 线上数据库、线上 API 和模型 | 未访问 | 未验证 |

特别核对的历史易缺字段包括 `users.is_authorized`、`cart_mutations.payload_hash/response_json`、`cart_quotes.selected_sku_ids/shopping_task_id/rule_version/consumed_at`、`order_items.product_name_snapshot`、`shopping_tasks.operation_token/operation_started_at/active_user/revision/data_json/commit_after`，当前实际库均具备。`shopping_tasks` 已无旧 `mode` 列，与当前 INSERT 一致。

## 3. 已追踪的实际调用链

| 入口 | 共用链路 | 主要表 |
| --- | --- | --- |
| 注册、登录、授权 | `auth/*`、`me/authorization` → `user-repository` → `getDbPool`；会话只保存签名用户 ID 和过期时间 | users |
| 网页目录、详情与评论 | `products/categories` API → `catalog`；分类、排序和分页在服务端，评论返回前脱敏 | categories、products、inventory_skus、product_reviews |
| 首页搜索助手 | assistant/search → `resolveAssistantIntent` → 工具注册表 → 进程内 catalog MCP → catalog 查询/条件评估 | products、product_search_aliases、categories、inventory_skus、product_reviews |
| 普通购物车 | 页面 → `lib/cart-client` → carts API → `reconcileCart` / `quoteCart` / `submitWebOrder` | carts、cart_items、cart_mutations、inventory_*、cart_quotes、order_* |
| 独立 AI 交易 API | assistant/cart、assistant/order → tool-calls → commerce-server → 同一购物车/报价/订单服务 | 与普通结账共用交易表，购物车 source 固定为 AI |
| 对话购物任务 | assistant/messages 或 tasks → dialogue/task service → `updateTask` 原子迁移 → 锁外准备和建单 → 结果写回；recover 复用任务订单幂等键 | shopping_tasks、共用交易表 |
| 任务取消与短链 | 取消屏障 → 固定任务 ID 创建短链；handoff → `submitPaymentLinkOrder` → 共用购物车/报价/AI 建单 | payment_links、users、共用交易表 |
| 库存到期释放 | 内部 Bearer 密钥校验 → 分批锁定到期预留 → 释放 reserved、标记 EXPIRED、记录事件 | inventory_reservations、inventory_skus、inventory_reservation_events |
| 评论分析恢复 | 评论快照分页与分析进度 → 购物任务 JSON 中持久化进度和 reviewHold | product_reviews、shopping_tasks |
| 本人订单读取 | me/orders → `readOrderViews`，使用商品名称快照和报价绑定的任务来源 | order_groups、orders、order_items、cart_quotes、shopping_tasks |

计价链路仍共用 `quoteCart()` → `calculateBestQuote()`；网页/AI 建单在提交前复用同一价格函数重算，未在本次搜索范围发现第二份优惠公式。金额转换与行小计复用 `toMinor()` / `lineSubtotalMinor()`；优惠资格存在下述独立问题，不能据此认定计价业务全部正确。

## 4. 发现的问题

### A01 · P1 · 购物车 JSON 幂等回放会对已解析对象再次 JSON.parse

位置：`lib/repository/cart-service.ts:84-92`；`db/ddl.sql:148-155`；本地 mysql2 驱动 `lib/parsers/binary_parser.js:68-74`、`connection_config.js:195`。

`cart_mutations.response_json` 是真实 JSON 列，连接池没有启用 `jsonStrings`。安装的 mysql2 对 JSON 默认执行解析，而回放分支无条件执行 `JSON.parse(existing[0].response_json as string)`；类型断言不会转换运行时对象。因此同一购物车幂等键再次调用时可能因对象二次解析抛错，破坏加购/任务恢复/短链重试。订单服务和任务存储已经同时兼容字符串与对象，购物车没有采用同样处理。

建议：回放时区分字符串与对象，校验存储响应结构；不要通过全局修改 JSON 解码配置来掩盖局部问题。证据：源码与安装驱动行为，未实际执行幂等回放。

### A02 · P1 · 事务占用连接后再次从同一连接池申请连接

位置：`lib/repository/quote-service.ts:57-88`；`lib/repository/order-service.ts:233-305,387-455`；`lib/catalog/products.ts:460-469`；`lib/repository/db.ts:76-77`；短链 `payment-link-service.ts:103,214-221`。

报价和建单已持有事务连接，却调用内部使用 `getDbPool().query()` 的目录查询，因此一次请求还需要池中另一条连接。池上限为 10、等待队列不限。当多个请求各持有连接并都进入目录读取时，可能占满池后相互等待，事务和行锁无法释放。短链还会持有外层连接调用多个独立服务，进一步增加连接需求。

建议：事务内目录/资格/库存读取复用当前 PoolConnection，明确事务上下文；不要只增加池上限。证据：源码可构造的资源等待条件，未做并发复现或连接池压测。

### A03 · P1 · 短链失效与订单创建跨多个事务，异常后无法原子恢复

位置：`lib/repository/payment-link-service.ts:214-249`；共用购物车、报价、订单服务各自 begin/commit；订单幂等绑定检查 `order-service.ts:390-405`。

短链外层事务锁定链接，但 `reconcileCart`、`quoteCart`、`submitAiOrder` 使用各自连接并分别提交。订单成功后，若链接 `deleted_at` 更新或外层 commit 失败，外层 rollback 无法撤销已提交订单，接口却会返回失败。同键重试又会重新生成 quoteId，和既有订单绑定的 quoteId 不一致，不能稳定取回原结果；当前前端每次提交还生成新幂等键（`app/handoff/page.tsx:60-64`），结果不确定时有重复购买风险。

建议：将短链核销与建单纳入同一事务，或使用持久化结账操作记录与稳定的请求/报价/订单绑定，先恢复原结果再决定后续动作。证据：事务边界和幂等条件的源码推导，未制造故障或创建订单。

### A04 · P2 · 短链幂等键校验长度与数据库列容量不兼容

位置：`lib/repository/payment-link-service.ts:209-211,223,238`；`db/ddl.sql:141,150,184`。

入口允许最长 128 字符的幂等键，内部还拼接 `link-reconcile-`（15 字符）和 `link-order-`（11 字符），分别达到 143 和 139 字符；事件 request_key、cart_mutations 和 order_groups 的对应列均为 VARCHAR(128)。有效入参因而可能无法无损写入数据库：严格模式下报超长，非严格模式下存在截断、幂等碰撞风险。前端默认 UUID 暂时掩盖了边界问题。

建议：将内部派生键固定为有命名空间的摘要，或按所有持久化位置统一限制并校验派生后的长度。证据：源码长度计算与实际列类型；未发送边界请求。

### A05 · P1 · 优惠 C 资格仅看 AI 来源，未验证对话任务绑定

位置：`lib/repository/quote-service.ts:105`、`order-service.ts:90`、`promotion-eligibility.ts:16-25`；对照仓库 AGENTS.md 及 `docs/v0.1-current/requirements-list.md:74` 的 U-09。检查期间需求文档正在归并，最终引用已刷新为当前目录。

独立 assistant/cart/quote 可以在没有 shoppingTaskId 的情况下获得 C：报价与下单都以 `source === 'AI' && !linkCheckout` 计算资格。既有任务查询函数已被注释。订单重算虽然仍共用同一公式，但资格来源与当前记录的“仅服务端绑定的对话购物任务”口径不符；已有任务报价的幂等前缀校验只能阻止挪用该报价，不能补足无任务 AI 报价的资格检查。

建议：资格判断集中在 promotion-eligibility 并在报价/建单事务内验证任务与用户绑定。若产品确实改为所有 AI 来源都可享，则先更新业务批准记录、规则版本及旧报价处理；不能以代码注释视为已批准。

### A06 · P2 · 商品 ID 与 SKU ID 被默认视为相同

位置：`app/page.tsx:117-120`、`app/products/detail/page.tsx:88-91`、`lib/agent/auto-shopping.ts:175-176`、`lib/repository/cart-service.ts:65-68,158`。

页面/Agent 提交的是 catalog product.id；服务却直接将 item.id 视为 skuId，并用 inventory_skus.sku_id 查询，没有按 inventory_skus.product_id 解析。DDL 将两个字段独立定义，只限制 product_id 唯一，未保证两者相等。当前种子两者恰好相等；对于 schema 合法但 ID 不相等的商品，会报库存不可用或无法正常加购。只读范围未查询业务行，未断言当前库已有这种数据。

建议：明确接口 ID 契约，在服务端按真实商品 ID 解析 SKU 后再锁定库存，避免依赖种子数据巧合。

### A07 · P2 · 库存操作加锁顺序存在不一致和大范围锁等待风险

位置：`lib/repository/order-service.ts:292-293,450-451,111-118`；`lib/repository/cart-service.ts:106-158`；`app/api/internal/inventory/expire/route.ts:51-58`。

建单先通过购物车条目 JOIN inventory_skus 的 FOR UPDATE 取得库存相关锁，随后读取预留；到期释放先锁预留再更新库存。reconcile 还会在每次购物车修改中扫描并锁定全库到期预留，没有与独立回收接口一样限制批次。这些路径具备锁顺序相反和跨用户锁等待的条件。实际锁获取次序还受执行计划影响，未做并发复现，不能声称已发生死锁。

建议：统一 SKU/预留的显式加锁顺序和排序，并将全局过期清理与单车修改合理分批，保留数量不变式和 affectedRows 校验。

### A08 · P1 · 当前工作区仍缺少通用商品主体核验，原串类风险未封闭

位置：`lib/catalog/products.ts:98-106,314-334`、`lib/catalog/condition-assessment.ts:67-87`。

本次实际读取的源码中，关键词仍匹配名称、品牌、分类、描述和规格任一子串；条件评估器只核实 requiredConditions/preferences，无额外条件时直接返回商品。没有看到前文讨论的通用主体校验实现。用途相关、名称包含关键词的器具仍可能被当作所请求商品，且在 differences 为空时进入自动下单候选。这是对当前文件的审计结论，不推测前一轮修改为何不在当前工作区。

建议：用目录细分类型/运营元数据或通用、有证据的主体评估封闭该边界，不恢复咖啡专用正则。未查询真实商品或调用线上搜索，未声称当前数据已复现误单。

## 5. 需保留的业务/发布缺口

- `needs_human_review`：`payment-link-service.ts:209-210` 只检查支付密码非空和长度，未验证其真实性，页面却展示“输入支付密码后即可下单”。当前没有真实支付接入；这不能当成已经实现支付密码授权，也不能因此自行增加支付字段或支付业务。应明确演示口径或另行批准验证机制。
- 升级缺口：当前 DDL 是 CREATE TABLE IF NOT EXISTS 的最终建表脚本，已有迁移文件在工作区处于删除状态。它能初始化空库，却不会为已存在的旧表补列或移除旧 mode 约束。当前本地库已对齐，不代表对线上旧库重新运行该 DDL 就完成升级；部署应先只读核对目标库，再按已应用版本制定增量迁移。本次未恢复或执行任何迁移。
- 动态 SQL 已做源码检查，但没有执行生产 SELECT、EXPLAIN、FOR UPDATE、事务回滚场景或真实并发；索引存在不代表当前执行计划/性能已验证。
- 未读取业务行，因此未核对库存总量与预留数量、孤儿业务记录、历史 JSON 内容、旧订单快照覆盖率或线上价格数据。相关内容属于数据一致性检查，不能从元数据结果中推断通过。
- 已阅读部分现有 mock/集成用例以理解断言；没有执行结果，不报告 passed/failed/skipped 数量，不推断 CI 通过。

## 6. 建议处理顺序

先处理 A01/A02/A03，恢复幂等与事务可靠性；随后处理 A04 的列长契约。A05 应先对齐已记录的 C 资格边界；最终费用规则仍保留文档中的 needs_human_review，不因现有代码或文档更新而视为已批准变更。A08 需封闭主体串类。A06/A07 随共用库存/事务边界一起处理。任何修复后仍须区分静态自检、隔离库验证与线上验收，本次未替用户执行这些步骤。
