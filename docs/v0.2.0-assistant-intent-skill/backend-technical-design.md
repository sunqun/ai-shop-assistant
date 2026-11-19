# 意图识别增强后端技术文档

## 1. 版本、技术栈与边界

- 版本：`v0.2.0-assistant-intent-skill`，更新时间：2026-11-19（Asia/Shanghai）；对 `v0.1.0` 的 M4 意图识别环节做增强，不动 M4 只读边界与目录/购物车/报价/下单链路。
- 依据：[需求功能清单](requirements-analysis.md) D-10～D-14、F-22～F-26、AC-22～AC-27。
- 技术栈：Next.js（App Router + Route Handler）、TypeScript、MySQL 8/InnoDB；大模型走 `MODEL_BASE_URL`/`MODEL`/`DEEPSEEK_API_KEY` 的 OpenAI 兼容 `/chat/completions`，改用 `tools` + `tool_choice` 做结构化输出。
- 本期不引入 ReAct 工具循环、不引入独立 MCP Server 传输、不落库保存会话历史；已确认单实例部署，会话历史使用进程内内存 `Map`（上限 1000 会话、单会话 30 分钟过期、LRU 淘汰），重启即失效、不跨实例。

## 2. 数据流

```mermaid
flowchart LR
  Web[React 助手面板] -->|query, sessionId?| Route[POST /api/v1/assistant/search]
  Route --> Session[内存 SessionStore]
  Session --> History[最近 N 轮 query+intent 摘要]
  Route --> Orchestrator[searchProductsForAgent]
  Orchestrator --> IntentParser[意图解析器 function calling]
  IntentParser -->|system 分层提示词 + 历史| LLM[大模型]
  LLM -->|tool_calls[0].arguments| IntentParser
  IntentParser --> Normalize[Schema 校验与归一化]
  Normalize --> ToolRegistry[invokeAgentTool search_products]
  ToolRegistry --> Catalog[目录查询 + 别名展开 + 排除子句]
  Catalog --> DB[(MySQL)]
  Catalog --> Route
  Route --> Web
  Route --> Session
```

与 `v0.1.0` 的差异集中在 `IntentParser`（json_object → function calling）与 `Catalog`（新增排除子句）两处，以及新增 `SessionStore`。工具注册表与目录 MCP 契约不变。

## 3. 意图 Schema 扩展

`lib/catalog/types.ts` 的 `ProductSearchIntent` 新增三个**可选**字段（可选是为了不破坏 `listCatalogProducts` 等无意图调用与既有测试）：

```ts
export type ProductSearchIntent = {
  keywords: string[];
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStockOnly: boolean;
  specTerms: string[];
  // 新增：否定与纠错
  excludeTerms?: string[];       // 出现在名称/品牌/品类/描述/规格中即排除
  excludeBrands?: string[];
  excludeCategories?: string[];
};
```

约束：
- `excludeTerms`/`excludeBrands`/`excludeCategories` 均为 `string[]`，缺失等价于空数组。
- 同一词若同时进入 `keywords` 与 `excludeTerms`，以排除为准（纠错语义优先），避免「不是X是Y」时 X 被当正向关键词。
- 归一化仍沿用现有 `clampNumber`/`stringList` 思路，只加类型、长度与去重，不做语义猜测。

## 4. 意图解析器：function calling + 分层提示词

`lib/assistant-agent.ts` 的 `parseProductSearchIntentWithMode` 改造如下：

### 4.1 工具定义（skill 的接口）

把意图解析声明为带 JSON Schema 的工具，`tool_choice` 强制只调用它：

```ts
const INTENT_TOOL = {
  type: "function",
  function: {
    name: "parse_product_search_intent",
    description: "解析用户商品搜索意图，输出结构化筛选条件；不回答用户问题、不推荐商品、不访问数据库。",
    parameters: {
      type: "object",
      properties: {
        keywords:      { type: "array", items: { type: "string" } },
        category:      { type: ["string", "null"] },
        brand:         { type: ["string", "null"] },
        minPrice:      { type: ["number", "null"] },
        maxPrice:      { type: ["number", "null"] },
        minRating:     { type: ["number", "null"] },
        inStockOnly:   { type: "boolean" },
        specTerms:     { type: "array", items: { type: "string" } },
        excludeTerms:       { type: "array", items: { type: "string" } },
        excludeBrands:      { type: "array", items: { type: "string" } },
        excludeCategories:  { type: "array", items: { type: "string" } },
      },
      required: [
        "keywords", "inStockOnly", "specTerms",
        "excludeTerms", "excludeBrands", "excludeCategories",
      ],
    },
  },
};
```

### 4.2 请求体

```ts
body = JSON.stringify({
  model: requiredEnv("MODEL"),
  temperature: 0,
  tools: [INTENT_TOOL],
  tool_choice: { type: "function", function: { name: "parse_product_search_intent" } },
  messages: [
    { role: "system", content: buildIntentSystemPrompt() },
    ...historyMessages,                    // 可选：最近 N 轮
    { role: "user", content: normalizedQuery },
  ],
});
```

### 4.3 结果解析

从 `data.choices[0].message.tool_calls[0].function.arguments` 取 JSON 字符串，`JSON.parse` 后交给 `normalizeIntent`；不再从 `message.content` 抠 JSON。保留 `normalizeIntent` 的类型/长度/数值/去重与「同词既是品类又是关键词时只留关键词」的既有逻辑，新增排除字段归一化与「排除优先」规则。模型不可用、超时或 `tool_calls` 缺失时，仍走 `fallbackIntent` 降级（短商品词，查询仍走真实目录数据库）。

### 4.4 分层提示词（skill 的 body）

系统提示词按 SKILL.md「自包含指令集」的形态编写，分四层（不新增对外文件，作为常量或 `references/` 文本维护）。核心原则：意图判断的是用户本轮**想做什么操作**，不是内容本身的性质。

1. **角色与边界**：只做理解与结构化，不回答、不推荐、不查库、不编造字段。

2. **内容类型判断**（先分域）：
   - `chat`（闲聊/问候/超域，无商品诉求）→ 返回空意图（`keywords=[]`、`specTerms=[]`、`inStockOnly=false`、排除全空），不搜索。
   - `search`（含商品/品类/品牌/预算/评分/库存/规格/排除诉求）→ 进入意图类型与实体抽取。

3. **意图类型判断**（再判操作，仅在 `search` 内）：

   | 意图 | 定义 | 判定关键词 | 典型输入 |
   |------|------|------------|----------|
   | `new`（兜底） | 新一轮直接找商品，未表达纠错/继承/补充 | 无特定关键词，默认兜底 | "要蓝牙耳机" |
   | `supplement` | 在上一轮条件上追加 | 再加、还要、顺便、也 | "再加个蓝牙耳机" |
   | `correct` | 纠错/否定，排除或替换条件 | 不要、不是、除了、换成、改成 | "不要白色""不是苹果" |
   | `inherit` | 指代/延续上一轮，需结合历史消解 | 它、那个、刚才的、上面的 | "那个有没有黑色" |

   判定优先级：`correct` → `supplement` → `inherit` → 兜底 `new`。否定与纠错写入 `excludeTerms/excludeBrands/excludeCategories`；正向诉求写入 `keywords/category/brand/specTerms`；`supplement`/`inherit` 需结合历史输出合并后的完整意图。

4. **实体抽取与指代消解**：结合历史把「它/那个/刚才的」展开；输出干净词，别名由目录别名表处理；不把「有没有/我要买」等问法词放进关键词。

特殊场景：
- `chat` → 不搜索，返回空意图。
- 指代无法唯一确定对象 → 不臆测，按可确定部分降级为 `new` 检索，或输出空关键词交由服务端 fallback。
- 意图无法判断 → 兜底按 `new`（关键词检索）。

历史注入只包含最近 N 轮的 `{ query, intentSummary }`（结构化摘要），不注入原始评论、排序分数、毛利或账户信息。

## 5. 目录查询：排除子句

`lib/catalog/products.ts` 的 `buildIntentWhere` 在既有 `AND` 子句后追加否定条件。否定词与正向词同匹配范围（名称/品牌/品类/描述/规格），整体用 `NOT (...)` 包裹：

```ts
function buildExcludeClause(intent: ProductSearchIntent, params: Array<string | number>): string {
  const exclude = [
    ...(intent.excludeTerms ?? []),
    ...(intent.excludeBrands ?? []).map((b) => b),      // 品牌排除仍走名称/品牌字段
    ...(intent.excludeCategories ?? []),
  ];
  const clauses: string[] = [];
  for (const term of exclude) {
    const value = likeTerm(term);
    clauses.push(
      "(p.name LIKE ? OR p.brand LIKE ? OR c.name LIKE ? OR p.description LIKE ? OR CAST(p.specs AS CHAR) LIKE ?)"
    );
    params.push(value, value, value, value, value);
  }
  return clauses.length ? `AND NOT (${clauses.join(" OR ")})` : "";
}
```

注意：排除条件用 `AND NOT (...)`，每个被排除词内部为 `OR`（命中任一即排除）。否定匹配范围已确认为全范围（名称/品牌/品类/描述/规格），`excludeBrands`/`excludeCategories` 一并并入通用排除词。

## 6. 服务端内存会话

新增 `lib/agent/session-store.ts`：

```ts
export type AssistantTurn = {
  query: string;
  intentSummary: string;
  createdAt: number;
};

const sessions = new Map<string, { turns: AssistantTurn[]; updatedAt: number }>();
```

- `getOrCreateSession(sessionId?)`：无 `sessionId` 时生成随机 id；`sessionId` 超长或不合法时按新会话处理。
- `appendTurn(sessionId, turn)`：追加并裁剪到最近 N 轮（默认 5）。
- `buildHistoryMessages(sessionId)`：把历史转为注入提示词的 `user/assistant` 消息。
- 容量与淘汰：上限 1000 会话、单会话 30 分钟过期、LRU 淘汰（已确认 Q-09）。

已确认单实例部署，内存实现是单实例方案：`next dev`/生产构建各自独立，多副本部署时不共享历史，重启即失效。文档与代码注释需明示该限制。

## 7. 编排层与 API 契约

`lib/agent/orchestrator.ts` 的 `searchProductsForAgent` 增加可选 `sessionId` 入参，透传历史到意图解析，并在成功返回时回填会话历史。

`app/api/v1/assistant/search/route.ts`：

- 请求：`{ query, cursor?, pageSize?, sessionId? }`。
- 响应新增 `sessionId: string`（新建时返回，前端后续携带）；`intentSummary` 扩展为包含排除条件，例如「已按“蓝牙耳机，排除：白色”筛选」。
- `sessionId` 仅用于定位服务端历史，不用于鉴权；历史注入不含敏感数据。

`makeIntentSummary` 在 `parts` 中追加「排除：A、B」以反映否定条件。

## 8. 可靠性、观测与验证

- 工具调用失败（超时/无 `tool_calls`/JSON 解析失败）降级到 `fallbackIntent`，仍走真实目录查询，行为与 `v0.1.0` 一致。
- 否定字段为可选，缺失时查询结果与旧版一致，不引入回归（AC-27）。
- 指标：意图解析成功/降级率、工具调用失败率、会话命中率（多轮请求数）、否定条件命中率。
- 验证：对应 AC-22～AC-27；重点覆盖 function calling 返回结构、否定/纠错 SQL 排除、指代消解、意图继承、内存 session 隔离与重启失效、无 sessionId 新建会话。
- 不在日志中记录完整会话历史、未脱敏评论或内部排序字段。

## 9. 与 ReAct 的边界

本期**不引入 ReAct/工具循环**：意图解析是单次工具调用即可完成的抽取任务。未来若要做端到端购物助手（搜索→看结果→再筛/加购/报价/下单的自主编排），可在既有 `lib/agent/tool-registry.ts`（已注册 `search_products`/`ai_reconcile_cart`/`ai_quote_cart`/`ai_submit_order`）之上扩展循环，但那是独立 scope，不在本期交付。
