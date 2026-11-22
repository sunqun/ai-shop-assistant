# 手动测试用例（链路验收）

更新日期：2026-11-21。范围：桌面浏览器商城 + 内置 AI 搜索助手 + AI 购物对话页。

本文档面向手动验收，按「链路」组织测试步骤、预期结果与通过标准。重点覆盖统一意图识别的三层短路链路，并覆盖登录授权、商品浏览、购物车报价建单、AI 搜索、AI 购物对话、交接短链和订单记录等业务链路。

测试观察方式以两个入口为准：

- 网页 UI：打开 <http://localhost:3000>，按步骤操作并观察页面反馈。
- API：用浏览器 DevTools 的 Network 面板查看接口响应，或用 `curl.exe` 直接调用（PowerShell 里请用 `curl.exe`，不要用 `curl` 别名）。

---

## 1. 前置准备

1. 执行 `npm install`，配置数据库环境变量（见 [README](../../README.md)），并确保 `db/ddl.sql` + `db/dml.sql` 已执行。
2. 生产/本地至少配置 `AUTH_SESSION_SECRET`，以及一组 MySQL 连接变量或 `MYSQL_URL`。
3. 启动服务：

   ```bash
   npm run dev
   ```

4. 打开 <http://localhost:3000>，确认首页商品列表可正常加载。
5. 若要测试模型兜底层（第三层），需配置 `MODEL_BASE_URL`、`MODEL`、`DEEPSEEK_API_KEY`；若都不配置，则模型层会进入「模型不可用」澄清路径，同样可测。

---

## 2. 统一意图识别三层链路

统一识别入口为 `resolveAssistantIntent()`，按确定性从高到低短路，命中即返回，未命中才落到下一层：

| 层 | `routing.layer` | `routing.engine` | 触发内容 |
| --- | --- | --- | --- |
| 第一层 规则层 | `rule` | `rules` | 精确命令；或目录主体精确匹配（唯一别名/商品名） |
| 第二层 上下文层 | `context` | `state` | 结合上一轮对话/任务状态的确定性规则 |
| 第三层 模型兜底层 | `fallback` | `llm` | 前两层未命中时，一次结构化模型解析 |

每条用例的「判定字段」来自接口响应中的 `routing` 对象（`layer` / `engine` / `action` / `reason` / `confidence`）。

> 首页搜索接口 `POST /api/v1/assistant/search` 会始终返回 `routing`，是最方便观察分层结果的入口；非搜索动作会返回空商品列表，但 `routing` 仍然保留，可据此判断命中在哪一层。

### 2.1 第一层：规则层

#### 用例 I-01 精确命令命中

- 目的：验证固定口令走 `exact_command` 规则，不进入模型。
- 操作（curl）：

  ```bash
  curl.exe -X POST http://localhost:3000/api/v1/assistant/search `
    -H "Content-Type: application/json" `
    -d '{"query":"确认下单"}'
  ```

- 预期：`routing.layer = "rule"`、`engine = "rules"`、`action = "confirm_order"`、`reason = "exact_command"`、`confidence = 1`；`products` 为空。
- 通过标准：`routing` 四个字段与预期一致，且 `layer` 不是 `fallback`。

可替换 `query` 复测同类命令：

| 输入 | 预期 `action` |
| --- | --- |
| `取消下单` / `取消` | `cancel_task` |
| `当前进度` | `query_status` |
| `分析评论` | `analyze_reviews`，`reviewMode = "reuse"` |
| `继续分析评论` | `analyze_reviews`，`reviewMode = "continue"` |
| `重新分析评论` | `analyze_reviews`，`reviewMode = "refresh"` |

#### 用例 I-02 目录主体精确匹配（唯一别名）

- 目的：验证「我想买 + 唯一别名」走 `unique_catalog_subject` 规则，不进入模型。
- 操作（curl）：

  ```bash
  curl.exe -X POST http://localhost:3000/api/v1/assistant/search `
    -H "Content-Type: application/json" `
    -d '{"query":"我想买充电宝"}'
  ```

- 预期：`routing.layer = "rule"`、`engine = "rules"`、`action = "new_search"`、`reason = "unique_catalog_subject"`、`confidence = 1`；`intentSummary` 或商品结果中出现「行動電源」相关语义。
- 通过标准：`reason = "unique_catalog_subject"`，且返回的 `products` 与目录中「行動電源 / 輕量行動電源 10000mAh」相关（若已载入对应商品）。

#### 用例 I-03 目录主体精确匹配（唯一商品名）

- 目的：验证「我想买 + 唯一商品名」同样走规则层。
- 操作：`query` 换成某个目录中唯一存在的商品名，例如 `我想买智能办公套装`（以实际载入的商品名为准）。
- 预期：`reason = "unique_catalog_subject"`、`action = "new_search"`。
- 通过标准：`routing.reason` 为 `unique_catalog_subject`。

#### 用例 I-04 目录主体歧义时下坠（负向）

- 目的：验证别名对应多个标准词时，规则层不强行命中，下坠到下一层。
- 操作：`query = "我想买瑜伽垫"`（该别名在别名表对应多个 canonical）。
- 预期：`routing.layer` 不为 `rule`（应为 `fallback` 或最终 `clarify`），即 `reason` 不是 `unique_catalog_subject`。
- 通过标准：`reason != "unique_catalog_subject"`，说明歧义未被误判为唯一目录主体。

### 2.2 第二层：可信上下文层

上下文层依赖「同一会话的上一轮结果」，因此需要带 `sessionId` 连续调用。

#### 用例 I-05 「再便宜一点」压低价格上限

- 目的：验证上下文规则 `strictly_below_current_candidate_price`。
- 步骤：
  1. 首次搜索，拿到 `sessionId`：

     ```bash
     curl.exe -X POST http://localhost:3000/api/v1/assistant/search `
       -H "Content-Type: application/json" `
       -d '{"query":"我想买蓝牙耳机","sessionId":"ctx-001"}'
     ```

     预期返回商品，并回传 `sessionId = "ctx-001"`。

  2. 复用同一个 `sessionId` 追加一句：

     ```bash
     curl.exe -X POST http://localhost:3000/api/v1/assistant/search `
       -H "Content-Type: application/json" `
       -d '{"query":"再便宜一点","sessionId":"ctx-001"}'
     ```

- 预期：`routing.layer = "context"`、`engine = "state"`、`action = "refine_search"`、`reason = "strictly_below_current_candidate_price"`、`confidence = 1`。
- 通过标准：第二步的 `routing` 命中 `context` 层，且 `action = "refine_search"`。

#### 用例 I-06 「就它吧」接受当前候选（需先进入澄清态）

- 前置：先通过一次带未决必需条件的搜索，使响应出现 `clarification`（`phase` 变为 `needs_clarification`）且存在候选商品。
- 操作：在同一 `sessionId` 下追加 `query = "就它吧"`。
- 预期：`routing.layer = "context"`、`engine = "state"`、`action = "select_product"`、`reason = "accept_current_candidate_preferences"`。
- 通过标准：命中 `context` 层且 `action = "select_product"`。
- 说明：若当前需求没有产生澄清态，本用例无法触发，属正常，跳过并记录原因。

#### 用例 I-07 补数字槽位（需上一轮存在 pendingSlot）

- 前置：上一轮搜索产生 `clarificationContext.pendingSlot`（`kind = "number"`），等待用户回答具体数值。
- 操作：在同一 `sessionId` 下回复该数值（例如 `500` 或带单位的数值）。
- 预期：`routing.layer = "context"`、`engine = "state"`、`action = "fill_slot"`、`reason = "answer_to_pending_numeric_slot"`。
- 通过标准：命中 `context` 层且 `action = "fill_slot"`。
- 说明：`pendingSlot` 由具体商品与条件决定，若未出现则跳过并记录原因。

### 2.3 第三层：模型兜底层

#### 用例 I-08 复杂自然语言走模型解析

- 目的：验证规则/上下文未命中的复杂请求进入一次模型解析。
- 操作（curl）：

  ```bash
  curl.exe -X POST http://localhost:3000/api/v1/assistant/search `
    -H "Content-Type: application/json" `
    -d '{"query":"我想买一个大容量、支持快充的充电宝，预算500以内"}'
  ```

- 预期：`routing.layer = "fallback"`、`engine = "llm"`；`reason` 为 `structured_intent_parser`（模型可用时）。
- 通过标准：`layer = "fallback"` 且 `engine = "llm"`；模型可用时能返回结构化意图并触发商品检索。

#### 用例 I-09 模型不可用时澄清（负向）

- 前置：不配置 `MODEL_BASE_URL` / `DEEPSEEK_API_KEY`（或指向不可用地址），重启服务。
- 操作：用一条规则层无法命中的输入（例如上述复杂句子）调用搜索。
- 预期：`routing.layer = "fallback"`、`engine = "llm"`、`reason = "model_unavailable"`、`action = "clarify"`、`confidence = 0`，返回澄清提示。
- 通过标准：命中 `model_unavailable` 且不返回虚构商品。

---

## 3. 各业务链路

以下用例以 UI 为主，如无特别说明，均在浏览器完成。

### 3.1 登录与授权链路

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 首页点「登录」，切换「注册」，输入唯一用户名 + 8 位以上密码 | 注册成功并保持当前页面；新建用户默认未授权 |
| 2 | 重复注册同一用户名 | 提示用户名已存在，不创建重复账号 |
| 3 | 登录时密码错误 | 提示错误，不自动注册 |
| 4 | 进入「订单」页授权区，勾选「同意 AI 助手代为创建订单记录」并保存 | 保存成功，之后不再显示未授权 checkbox |

通过标准：步骤 1/2/3 反馈正确；步骤 4 后服务端以 `is_authorized = true` 放行后续建单。

### 3.2 商品浏览与详情链路

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 首页浏览商品列表 | 展示商品卡（名称/价格/库存/评分） |
| 2 | 切换分类、输入关键词、切换排序 | 结果按服务端重排，续页正常 |
| 3 | 点击商品卡进入详情 | 展示名称、价格、规格、可用库存、评分和首批评论 |
| 4 | 选择数量并「加入购物车」 | 加购成功有反馈；缺货时不能当作有货加购 |

通过标准：筛选/排序/分页结果正确；详情与评论展示完整；加购反馈正确。

### 3.3 普通购物车 → 报价 → 建单链路

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 进入购物车，勾选部分商品 | 只结算勾选条目，未勾选保留 |
| 2 | 修改数量 / 移除商品 | 重新同步库存分配与报价，旧报价失效 |
| 3 | 查看报价摘要 | 展示商品小计、优惠、运费、总额 |
| 4 | 点击「付款」 | 创建订单记录，展示购买摘要；不触发真实扣款 |

通过标准：勾选结算范围正确；库存不足时展示可履约/缺货量；未登录/未授权时被服务端拒绝（401/403），不建单。

### 3.4 首页 AI 搜索链路

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 首页右侧输入自然语言需求（如「我想买蓝牙耳机」） | 展示识别摘要、相关商品、规格、库存 |
| 2 | 追加条件（如「支持快充」） | 在同一会话合并条件并刷新结果 |
| 3 | 输入与商品无关的闲聊 | 返回「当前是商品搜索入口」提示，不检索商品 |

通过标准：结果来自真实目录，不返回内部权重/毛利；续页正常；闲聊不误检索。

### 3.5 AI 购物对话 → 无差异自动下单链路

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 登录并完成授权后，进入 `/assistant`，提交购买需求且商品无差异 | 展示候选商品、件数与报价，进入约 3 秒可取消窗口 |
| 2 | 在窗口内点取消 | 任务取消，不建单 |
| 3 | 不取消，等客户端推进请求到达 | 服务端校验时点/状态后自动建单 |

通过标准：可取消窗口内能取消；自动建单受服务端校验，不在页面伪造成功提示。

### 3.6 AI 购物对话 → 有差异确认下单链路

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 提交需求，商品与要求存在差异（如预算/品牌/规格不符） | 对话记录展示商品、数量、逐项差异与完整报价，输入框上方显示确认/取消行 |
| 2 | 输入精确确认口令（如「确认下单」）或点确认按钮 | 建单成功，展示订单回执 |
| 3 | 输入非精确的「好的、可以」类确认 | 不直接下单，继续澄清/引导精确确认 |

通过标准：件数贯通候选、报价与订单；确认须为精确命令且任务与报价匹配；下单结果来自服务端真实结果。

### 3.7 交接短链链路

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 登录后生成单商品短链（指定商品 + 1–99 件） | 返回链接，展示在右侧短链列表 |
| 2 | 复制链接，在无登录/新窗口打开 | 可匿名查看创建人显示名、商品和数量 |
| 3 | 在交接页提交结账 | 以令牌对应创建人身份重新校验购物车/库存/报价/授权并建单 |
| 4 | 成功建单后再访问该链接 | 链接按当前逻辑消费后失效 |

通过标准：匿名可查看但建单仍走服务端身份与授权校验；下单前长期有效、下单后失效。

### 3.8 订单记录链路

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 进入「订单」页 | 按时间倒序展示本人订单记录 |
| 2 | 展开订单详情 | 展示来源、编号、时间、商品名称快照、SKU、数量、金额及小计/优惠/运费 |
| 3 | 未登录访问订单接口 | 返回 401，不泄露他人订单 |

通过标准：只显示本人订单；商品名读取创建时快照，缺失时明确标注「历史商品名称未记录」，不冒用当前目录名称。

---

## 4. 通过标准汇总

- 意图识别：每条用例的 `routing.layer / engine / reason / action / confidence` 与预期一致；三层（`rule` / `context` / `fallback`）均至少各命中一次。
- 业务链路：主链路可演示成功路径；关键失败、权限不足、处理中状态可观察且不泄露敏感数据。
- 全程不出现：前端自算金额、客户端伪造库存/报价/授权、成功提示早于服务端真实结果。

## 5. 结果记录模板

| 用例编号 | 链路 | 操作方式 | 实际结果 | 是否通过 | 备注/失败原因 |
| --- | --- | --- | --- | --- | --- |
| I-01 | 意图·规则层·精确命令 | curl | | | |
| I-02 | 意图·规则层·目录主体 | curl | | | |
| I-05 | 意图·上下文层 | curl | | | |
| I-08 | 意图·模型兜底层 | curl | | | |
| 3.3 | 购物车→报价→建单 | UI | | | |
| 3.7 | 交接短链 | UI | | | |

> 实际执行时按本表逐条填写；失败用例记录现象、触发输入和复现步骤。
