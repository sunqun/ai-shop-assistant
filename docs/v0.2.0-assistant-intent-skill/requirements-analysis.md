# AI 助手意图识别增强需求功能清单

## 1. 版本与范围

- 版本：`v0.2.0-assistant-intent-skill`，更新时间：2026-11-19（Asia/Shanghai）。
- 前置版本：[`v0.1.0`](../v0.1.0/requirements-analysis.md) 的 M4「AI 助手商品推荐 Agent」（F-18、AC-15～AC-17）是本次增强的基线；本次不改变 M4 的只读边界。
- 范围：仅增强 M4 的**意图识别**环节，让大模型通过「工具调用（function calling）+ 分层分析提示词（skill）」产出结构化意图，并支持多轮对话。不新增商品/购物车/报价/下单能力。
- 配套：[后端技术文档](backend-technical-design.md)、[前端交互与技术文档](frontend-technical-design.md)、[模块拆分文档](module-delivery-splitting.md)。
- 桌面浏览器网页商城，不含移动端方案。

## 2. 确认记录与需求变更

| 决策 | 已确认内容 | 替代上一版内容 | 影响 |
| ---- | ---------- | -------------- | ---- |
| D-10 | 意图识别从 `response_format: json_object` 改为 OpenAI 兼容的 function calling（`tools` + `tool_choice`），把 `parse_product_search_intent` 定义成带 JSON Schema 的工具；API 层按 schema 强制落参，删除大部分 `extractJson`/`applyQueryFallback` 正则兜底 | 模型自由返回 JSON，再由后端正则与启发式修补 | 意图解析器、Schema、兜底逻辑 |
| D-11 | 扩展 `ProductSearchIntent`，新增 `excludeTerms`/`excludeBrands`/`excludeCategories` 表达「不要/除了/不是XX」等否定与纠错；目录查询增加 `NOT (...)` 排除子句 | 意图字段无法表达否定，模型可能把否定词当正关键词 | 意图类型、目录 SQL |
| D-12 | 多轮对话采用**服务端内存 session**（`sessionId -> 最近若干轮历史`），用于指代消解与意图继承；不落库、不跨实例、重启即失效 | 无多轮概念，每次请求都是单轮 | 助手搜索 API、服务端会话存储 |
| D-13 | 意图分析采用「分层提示词」：先判内容类型（闲聊/搜索），再判意图类型（新增/纠错/继承/补充），最后做实体抽取（含否定、指代消解）；提示词结构参考 SKILL.md 的「自包含指令集」形态 | 单段扁平提示词，只做字段抽取 | 意图解析器提示词 |
| D-14 | 同义与品类归一化继续由目录侧 `product_search_aliases` 表负责（`expandSearchTermGroups`），大模型只输出干净词，不在提示词里硬编码商品别名 | 别名/简称可能被硬编码进提示词 | 目录别名表、意图解析器 |

## 3. 目标与边界

目标：把 M4 的意图识别从「单次 JSON 抽取」升级为「工具调用 + 分层分析 + 多轮记忆」，让自然语言搜索在否定、纠错、指代和多轮延续等真实问法下仍能正确落成结构化筛选条件。

边界：
- 仍是**只读**意图解析 + 目录检索，不创建购物车、不报价、不写授权字段、不锁库存、不下单。
- 不引入 ReAct 工具循环（模型单次调用意图工具即可，不需要根据工具结果反复调用）。
- 服务端内存 session 不保证跨进程/跨实例一致，重启与横向扩容后历史丢失，标记为 `needs_human_review`。

## 4. 功能清单

| ID   | 功能                     | 行为与约束 | 优先级 |
| ---- | ------------------------ | ---------- | ------ |
| F-18 | AI Agent 商品返回（基线） | 沿用 v0.1.0，本次只增强其意图识别子环节 | P0 |
| F-22 | 工具调用意图解析         | 服务端用 `tools`+`tool_choice` 强制模型调用 `parse_product_search_intent`，参数由 JSON Schema 校验；返回 `keywords/category/brand/minPrice/maxPrice/minRating/inStockOnly/specTerms/excludeTerms/excludeBrands/excludeCategories`；不依赖正则从 markdown/自由文本里抠 JSON | P0 |
| F-23 | 否定与纠错意图           | 识别「不要/除了/只要…但不是…/不是X是Y」等限定，把否定部分写入 `excludeTerms/excludeBrands/excludeCategories`，目录查询按 `NOT (...)` 排除；不得把否定词当正向关键词 | P0 |
| F-24 | 多轮指代消解             | 服务端把最近若干轮「用户输入 + 已解析意图」注入上下文，模型把「它/那个/刚才的/上面的」展开为具体商品或条件；无法唯一确定时不臆测 | P0 |
| F-25 | 多轮意图继承             | 延续上一轮筛选条件（如「再加个蓝牙耳机」沿用当前价格/品牌过滤）；由模型输出合并后的完整意图，服务端做兜底合并 | P0 |
| F-26 | 同义与品类归一化         | 模型只输出干净品类/品牌词，目录侧 `product_search_aliases` 负责别名展开，避免因「手机 vs 智能手机」等措辞差异漏召回 | P1 |

## 5. 验收标准

| 编号  | 可验证结果 |
| ----- | ---------- |
| AC-22 | 意图识别走 function calling：模型必须返回 `tool_calls[0].function.arguments`，字段与 JSON Schema 一致；删除 `extractJson` 对 markdown 代码块/自由文本的解析兜底，保留少量类型/长度/数值归一化。 |
| AC-23 | 输入「要蓝牙耳机但不要白色」「找不是苹果的手机」等，解析结果把否定部分放入 `excludeTerms/excludeBrands/excludeCategories`，检索结果不出现被排除项，且 `intentSummary` 正确展示排除条件。 |
| AC-24 | 多轮中「再便宜一点」「只要蓝色的」「那个有没有黑色」能结合上一轮正确解析，不把指代词当商品关键词。 |
| AC-25 | 「再加个蓝牙耳机」能继承上一轮的价格/品牌过滤，返回合并后的意图与结果。 |
| AC-26 | 无 `sessionId` 时新建会话并返回 `sessionId`；同一 `sessionId` 连续请求能访问历史；不同 `sessionId` 不串历史；会话存储为内存实现，重启失效且不承诺跨实例一致（限制在文档中明示）。 |
| AC-27 | 否定字段缺失时查询结果与 v0.1.0 行为一致，不引入回归；`listCatalogProducts` 等无意图调用仍能正常执行。 |

## 6. 已确认项（本轮拍板）

| 编号 | 已确认内容 | 落地约束 |
| ---- | ---------- | -------- |
| Q-09 | 单实例部署，服务端内存 session；容量上限 1000 会话、单会话 30 分钟过期、LRU 淘汰 | 重启即失效、不跨实例；代码注释与文档明示该限制 |
| Q-10 | 模型输出合并后的完整意图为主，服务端做类型/长度/数值兜底 | 模型输出不完整时服务端再合并 |
| Q-11 | 否定排除匹配范围为全范围（名称/品牌/品类/描述/规格） | 用 `AND NOT (...)`，被排除词内部为 `OR` |
| Q-12 | 历史注入最近 5 轮，仅含 `query` + 结构化意图摘要 | 不注入未脱敏评论、排序分数、毛利或账户信息 |
