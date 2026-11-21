# 后端技术文档

> 本文为 v0.1 实现快照；对话下单流程已由 [v0.2 单一自动流程](../v0.2-unified-shopping/backend-technical.md) 取代。

更新日期：2026-11-21。本文描述当前实现的服务边界、调用链、数据与接口契约，不保留修复日志。

相关文档：[需求功能清单](requirements-list.md)、[前端交互与技术文档](frontend-technical.md)。本次仅整理文档，未执行模型、数据库或自动化用例；代码实现不等同于部署验收。

## 1. 技术与模块边界

后端使用 Next.js Route Handlers、TypeScript、Zod、mysql2/promise 和 MySQL；AI通过现有LLM适配器调用。涉及数据库、密码或令牌的接口在Node.js运行时处理。

| 层 | 位置 | 职责 |
| --- | --- | --- |
| HTTP | app/api/v1、app/api/internal | 请求解析、网页会话、参数约束、响应与错误映射。 |
| 意图 | lib/intent | 确定性规则、单次模型解析、本轮条件校验、历史合并与冲突澄清。 |
| Agent编排 | lib/agent | 搜索会话、动作分发、购物准备与工具调用，不替代交易校验。 |
| 购物任务 | lib/shop-task | 持久化任务、行锁状态迁移、准备/确认/取消/恢复及评论暂停。 |
| 内部工具 | lib/mcp、lib/agent/tool-registry.ts | 目录、评论、购物车、报价、建单和短链的进程内工具契约。 |
| 目录与评论 | lib/catalog、lib/reviews | 商品筛选、别名、规格核实、公开评论读取和有引用的分析。 |
| 领域与存储 | lib/repository、lib/pricing-domain.ts | 用户、库存、购物车、报价、订单、短链及统一计价。 |

~~~mermaid
flowchart LR
  W[网页] --> H[HTTP入口]
  H --> U[网页用户身份]
  U --> A[搜索或购物编排]
  A --> I[统一意图解析]
  A --> T[购物任务状态机]
  A --> R[内部工具注册表]
  T --> R
  R --> C[目录和评论服务]
  R --> S[购物车 报价 订单 短链服务]
  S --> DB[(MySQL)]
  C --> DB
  I --> L[LLM适配器]
~~~

工具当前为同进程函数调用，未提供标准远程MCP传输、工具发现和第三方委托授权。第三方AI接入仍为未实现范围，不因文件名包含MCP而视为已开放远程服务。

## 2. 身份与授权

- lib/auth/auth-server.ts 使用HMAC签名Cookie保存用户ID和到期时间；Cookie为HttpOnly、SameSite=Lax，生产环境启用Secure，有效期7天。
- 密码以随机盐+scrypt派生值保存，验证使用恒定时间比较；注册用户默认未授权。
- 登录时显式同意或 POST /api/v1/me/authorization 的consent=true可设置 users.is_authorized；当前仅提供false到true，不提供撤销和到期管理。
- 常规购物车、任务、订单和自有短链接口从服务端会话读取用户，不信任请求里的用户身份或授权布尔值。
- WEB和AI建单服务均读取现有用户授权字段。该字段是本期建单同意状态，不是支付扣款授权或第三方Agent grant。
- 交接短链是独立持令牌路径：匿名读/提交接口不读取网页会话，业务身份由链接绑定创建人派生，最终仍进入AI建单服务。此委托含义与凭证规则为 needs_human_review。

## 3. 商品目录与推荐

### 3.1 商品列表

- GET /api/v1/products 支持categoryId、keyword、sort、pageSize、cursor；pageSize默认20、最大100。
- sort允许recommended、rating、price-low、price-high，排序在数据库完整匹配集合上执行。
- 列表游标与筛选/排序上下文绑定；不向调用者开放内部SQL或推荐权重参数。
- ids模式支持最多100个合法商品ID批量读取；购物车页面按40个分批，不依赖目录首批数据。
- 公开商品视图包括ID、名称、品牌、分类、描述、价格、币种、可用库存、评分、评论数和规格；内部字段通过映射白名单隔离。

### 3.2 意图搜索与条件核实

- 商品别名由product_search_aliases维护，按输入词与标准词展开；不把商品别名硬编码进意图Prompt。
- 目录筛选使用绑定参数；商品词、品牌、预算、评分、库存和排除项进入受控查询。
- 数值规格先做单位换算和比较；自由文本条件由condition-assessment核实，未知必需条件保留澄清。
- 排除项和必需条件不能因模型省略而无依据撤销；无结果可正常返回空列表，不能放宽条件伪造推荐。

### 3.3 推荐排序

内部推荐分按当前实现对毛利率达到0.3的商品乘1.5；此数值只在服务端排序中使用，不返回商品公开视图，也不进入模型上下文。

当前阈值、适用范围及用户披露方式为 needs_human_review。显式价格/评分排序按用户选择执行，不把所有排序描述成推荐排序。

## 4. 单次意图解析

核心入口为 lib/intent/router.ts 的resolveAssistantIntent。

~~~mermaid
flowchart TD
  A[原始消息] --> B{完整精确命令}
  B -->|未命中| C{可信上下文规则}
  C -->|未命中| D{唯一目录主体}
  D -->|未命中| E[一次模型解析 动作与本轮条件]
  B --> O[统一结果]
  C --> O
  D --> O
  E --> F{是否搜索动作}
  F -->|是| G[原话证据 数量校验]
  G --> H[服务端历史合并与区间检查]
  H --> O
  F -->|否| N[清空搜索条件与编辑]
  N --> O
  O --> P[业务入口动作门禁]
~~~

### 4.1 路由顺序

1. 原话trim并受1000字符上限约束；消息HTTP入口拒绝空白或超长，内部空输入直接澄清。
2. 精确命令表按完整输入匹配确认、取消、进度和评论动作；保留问号，否定、长句和能力询问不因局部命中执行。
3. 可信上下文处理数值补槽、低于当前候选价格的更便宜检索、澄清阶段接受唯一候选偏好。
4. 唯一目录主体按真实别名/名称匹配，可直接形成新搜索；多义或不可用时继续模型解析。
5. 其余消息统一由parseModelIntent一次判断动作与条件，不存在独立轻量分类层。

### 4.2 输入输出

- 模型必须输出action和0–1的confidence；条件字段可省略，但返回值非法会使解析失败，不以默认搜索、空数组或数值截断静默放行。
- 模型动作：new_search、refine_search、select_product、confirm_order、cancel_task、query_status、analyze_reviews、chat、clarify。
- fill_slot由可信数值槽位规则产生；模型select_product只给明确选品引导，实际候选接受要求engine=state。
- 搜索字段包括keywords、category、brand、minPrice/maxPrice、minRating、inStockOnly、quantity、requiredConditions、preferences、numericConstraints和exclude*。
- quantity是明确的1–99正整数；服务端核实本轮件数，未提数量时由历史合并或业务默认处理；规格中的数量不自动当成购买件数。
- 非搜索动作允许只输出决策；解析器与统一路由清空夹带的搜索字段和edits，不进行历史搜索合并。
- routing记录layer、engine、action、confidence、reason，评论动作可带reviewMode。当前engine为rules、state、llm。

### 4.3 历史与证据

- new_search仅使用本轮条件；refine_search让模型只输出本轮变更，由mergeIntent统一继承完整历史。
- 未提及、空数组或null不等于撤销；edits携带field、clear/remove、values和本轮连续原话evidence，用于明确撤销或替换指定旧条件。
- 数值规格证据须对应本轮唯一连续片段，核对比较符、数值、单位及否定语域；真实槽位或可信历史提供受控补充依据。
- 同属性同量纲同侧边界可更新；另一侧边界和等值要求保留，除非明确撤销。预算倒置、数值区间冲突和单位维度冲突转clarify。
- 模型不能指定商品ID；只有可信上下文可锁定当前唯一候选。搜索准入置信度至少0.8。

### 4.4 模型调用

- 使用配置MODEL_BASE_URL、MODEL、DEEPSEEK_API_KEY构造现有LLM适配器；强制工具parse_product_search_intent，temperature=0，解析超时12秒。
- 保留传输层既有失败重试，单一解析阶段不等于网络绝不重试；模型不可用返回clarify、confidence=0。
- 评论分析和商品条件核实可另有模型调用，不属于重复的意图分类阶段；不能把整条购物链路描述为总共只有一次模型请求。
- 当前未提供真实模型识别率或端到端时延结论。

## 5. 搜索会话与购物任务

### 5.1 搜索会话

searchProductsForAgent使用服务端内存会话保存最近5轮查询/摘要及结构化上下文；上限1000会话，30分钟不更新过期。进程重启丢失、不跨实例共享，不作为用户认证依据。

搜索入口只处理搜索决策和目录读取；非搜索动作返回引导，不执行评论、订单或任务操作。

### 5.2 购物对话

handleAssistantMessage读取当前用户活动任务及指定任务，组装商品、已核实条件、阶段和评论上下文，只识别本轮一次。

- 评论、状态：置信度足够时分派各自服务。
- 确认、取消消息：仅engine=rules且reason=exact_command可进入交易动作；还须匹配当前任务，确认需匹配当前quoteId和cartVersion。
- 模型识别的交易意愿不构成授权，只返回明确指令或按钮引导。
- 搜索：已有活动交易时拒绝暗中替换；可继续的澄清状态以原条件创建后续任务。
- 所有执行能力仍由购物任务及底层业务服务复核。

### 5.3 任务状态

~~~text
queued → searching → selecting → reconciling → quoting
  → manual: awaiting_confirmation → committing → ordered
  → auto: ready_to_order → 到时且未暂停的advance → committing → ordered

允许取消的阶段 → cancel_pending / link_creating
  → canceled / canceled_no_product / canceled_link_failed

需要补充信息 → needs_clarification
结果不确定 → reconciling_result → recover
其他失败 → failed
~~~

- shopping_tasks持久化用户、模式、query、phase、revision、数据快照、commitAfter和操作租约。
- 状态迁移通过事务/行锁完成；耗时准备或提交在锁外执行，再核对操作标识回写。
- 当前按用户控制活动任务，revision供前端避免旧结果覆盖。
- manual等待明确确认；auto的commitAfter约为报价后3秒，需前端发送推进请求；reviewHold阻止自动提交。
- committing后不接受取消；结果不确定时复用原幂等键核对，不新建订单替代恢复。
- 取消后有候选则尝试创建单商品短链；稳定的服务端linkId用于恢复，失败可retry-link。

## 6. 购物车、库存、报价与订单

### 6.1 购物车和库存预留

- cartId由用户ID和WEB/AI来源确定性派生；同一用户的内置AI工具共用AI购物车，尚未区分第三方Agent。
- reconcileCart校验商品和数量，按可用库存分配，保存requested/allocated/unavailable数量和版本。
- 事务内处理到期预留、释放旧分配、重新分配并写库存事件；预留有效期24小时。
- 内部库存到期接口需Bearer INVENTORY_CRON_SECRET，部署端负责调度，不等同于应用已有常驻后台任务。
- 普通购物车保留分配和缺货结果；AI单商品任务若不足以满足已核实请求件数则澄清，不静默降件数。

### 6.2 统一计价和报价

金额存储为最小货币单位；统一由lib/pricing-domain.ts计算，公开报价包含subtotalMinor、discountMinor、shippingMinor、totalDueMinor、quoteId、cartVersion、expiresAt及ruleVersion。

- A：折前商品小计满100000分减10000分。
- B：折前商品小计满99000分免运，否则10000分。
- C：AI来源商品金额减5%，运费不折。
- 现有计算返回一个组合候选；不是遍历任意优惠顺序或候选集合。
- quoteCart核验来源、购物车版本、实际分配和有效预留；报价有效期为15分钟与预留到期时间的较小值。
- C是否仅适用于auto、叠加基数和允许组合的最终业务口径为 needs_human_review。

### 6.3 建单事务与回读

submitWebOrder和submitAiOrder校验当前用户与建单同意、来源、版本、报价和预留，按用户及幂等键复用已保存结果；相同幂等键不同参数拒绝。

建单事务保存订单组、订单项及金额摘要，消费库存预留并扣减on_hand/reserved，报价标记已使用，保存回执和审计来源。任务报价不能绕过任务确认直接通过普通AI提交工具使用。

订单查询按userid过滤，返回创建时商品名称快照、SKU、数量和单价及费用摘要；缺失旧名称快照不使用目录现名回填。当前没有完整商品规格历史版本或支付/履约状态机。

## 7. 评论读取与分析

- 详情接口返回首批评论和nextCursor，独立评论接口提供分页；当前详情页Reviews组件没有消费续页游标。分析工具使用固定评论ID上界的keyset快照分页，新增评论不会漂移到原快照的已读范围。
- 昵称掩码，常见联系方式及地址片段替换；评论表当前没有独立公开发布状态，现存记录作为公开源读取。公开范围和脱敏标准为 needs_human_review。
- readCount、analyzedCount、total和complete分开保存；报告状态为running、partial、complete或empty。
- reuse复用可用分析或回答追问；continue继续未完成分析；refresh仅在明确重读意愿下重建读取范围。
- 进度、游标、主题与租约保存在任务data_json；公开taskView隐藏内部进度索引和租约，提供报告、限制与原文引用。
- 原文引用须有可核实来源，评论正文只作为数据；分析模型不持交易工具。
- 自动任务可置reviewHold；恢复须使用resume-after-reviews。源变化、读取失败或模型异常不得伪装成全部分析完成。

## 8. 交接短链

- createPaymentLink绑定创建用户、单商品和数量，保存随机令牌及哈希；登录用户只能列出和删除自己的链接。
- 当前没有时间TTL，查询排除deleted_at；删除及成功交接建单后不可再按有效链接读取，不承诺字面“永久可用”。
- GET /api/v1/handoff按令牌匿名查看；POST按令牌绑定创建人调用AI购物车、报价和AI建单服务，成功后更新链接消费状态。
- 链接读取使用当前商品资料；不是历史商品/价格快照，也不是独立库存预留凭证。
- paymentPassword目前只检查非空和长度，没有独立密码核验或支付服务。不能将POST成功描述为真实扣款成功。
- 链接事务与购物车/报价/建单各服务的事务并非一个跨服务原子事务；失败恢复、重复提交边界、持链人委托权限及隐私披露为 needs_human_review。

## 9. HTTP接口分组

路径均相对商城站点；参数仍以对应Route Handler的Zod/领域校验为准。

| 接口 | 方法 | 身份/用途 |
| --- | --- | --- |
| /api/v1/auth/login、/register、/logout、/session | POST / POST / POST / GET | 网页身份建立、退出与读取。 |
| /api/v1/me/authorization | POST | 网页登录；consent=true授予现有建单同意。 |
| /api/v1/categories、/products、/products/detail、/products/reviews、/store-config | GET | 目录、详情、评论和站点展示配置。 |
| /api/v1/carts | GET | 当前登录用户WEB购物车。 |
| /api/v1/carts/reconcile、/quote、/order | POST | WEB购物车同步、报价和建单。 |
| /api/v1/assistant/search | POST | 只读自然语言搜索，query/pageSize/cursor/sessionId。 |
| /api/v1/assistant/messages | POST | 登录；query、mode、幂等键，按需携带taskId和quote；返回task/reply/routing等。 |
| /api/v1/assistant/tasks | GET、POST | 登录；当前活动任务查询和任务创建。 |
| /api/v1/assistant/tasks/[taskId] | GET | 登录；本人任务状态。 |
| /api/v1/assistant/tasks/[taskId]/[action] | POST | 登录；advance、cancel、confirm、retry-link、recover、resume-after-reviews。 |
| /api/v1/assistant/cart/reconcile、/cart/quote、/order | POST | 登录；AI购物车工具能力，遵守领域门禁。 |
| /api/v1/assistant/react、/react/confirm | POST | 现存ReAct准备/确认兼容入口；不作为网页新消息主入口。 |
| /api/v1/assistant/payment-links | GET、POST | 登录；本人短链列表和创建。 |
| /api/v1/assistant/payment-links/[linkId] | DELETE | 登录；本人短链删除。 |
| /api/v1/handoff | GET、POST | 持令牌匿名读取与现有交接提交路径。 |
| /api/v1/me/orders、/me/orders/[orderGroupId] | GET | 登录；本人订单列表/单组详情。 |
| /api/internal/inventory/expire | POST | 内部Bearer密钥；到期预留释放。 |

消息入口限制query为1–1000字符，mode为manual/auto，幂等键和taskId采用UUID。confirm操作提交当前quoteId与cartVersion。常见错误：401未认证、403授权不足、409版本/库存/报价/任务冲突、400参数无效、503服务暂不可用；具体映射由各入口决定。

## 10. 数据、部署和边界

| 数据组 | 主要表 |
| --- | --- |
| 用户与目录 | users、categories、products、product_reviews、product_search_aliases |
| 库存与购物车 | inventory_skus、carts、cart_items、inventory_reservations、inventory_reservation_events、cart_mutations |
| 报价与订单 | cart_quotes、order_groups、orders、order_items、order_audit_events |
| 交接与任务 | payment_links、shopping_tasks；任务表结构见db/migrations/011_create_shopping_tasks.sql |

- 建单代码依赖order_items.product_name_snapshot；已有数据库需具备db/migrations/012_snapshot_order_product_names.sql定义的字段。本文不代表该迁移已在目标环境执行。
- 数据库连接由MYSQL_URL/DATABASE_URL或现有MYSQL_*环境配置读取；AUTH_SESSION_SECRET用于会话签名和购物车派生。
- 库存定时调用需配置INVENTORY_CRON_SECRET与外部调度；意图/分析需现有模型配置。
- Next开发输出为.next-dev，生产输出为.next，不得合并；排查服务时只操作本项目对应进程和输出目录。
- 当前搜索会话不跨实例；多实例共享会话、后台持续推进、远程MCP、第三方委托和支付服务均不在现有实现内。
- 未确认的授权、订单、库存业务扩展、隐私、费用和支付口径保持 needs_human_review，不能因文档更新变成已批准方案。
