# 两个助手入口的当前逻辑

本文按当前实现梳理 `search-products-agent.ts` 与 `auto-shopping.ts` 的入口、共用逻辑及下单路径。

## 总览流程

```mermaid
flowchart TD
  subgraph Search[商品搜索助手：POST /api/v1/assistant/search]
    S0[AssistantDocker 提交 query、cursor、pageSize、sessionId] --> S1{请求 JSON 和 query 有效？}
    S1 -- 否 --> S400[返回 400]
    S1 -- 是 --> S2[校验 pageSize / cursor / sessionId]
    S2 --> C1[searchProductsForAgent]
    C1 --> C2[复用或创建内存会话；取上一轮意图和历史摘要]
    C2 --> C3[LLM 解析结构化商品意图]
    C3 --> C4{解析成功？}
    C4 -- 否 --> C5[正则降级提取短商品词]
    C5 --> C6{降级有商品词？}
    C6 -- 否 --> S503[返回可重试解析错误 / HTTP 503]
    C6 -- 是 --> C7[得到 fallback 意图]
    C4 -- 是 --> C8[得到 model 意图]
    C7 --> C9[与上一轮意图合并]
    C8 --> C9
    C9 --> C10{合并后为空意图？}
    C10 -- 是 --> SEmpty[返回空商品列表和 sessionId；不写入轮次]
    C10 -- 否 --> C11[search_products 工具 → Catalog MCP → 目录查询]
    C11 --> C12{目录调用成功？}
    C12 -- 否 --> SErr[返回结构化错误；不写入轮次]
    C12 -- 是 --> C13[保存 query、意图和摘要到会话]
    C13 --> SOK[返回商品、nextCursor、意图摘要、解析模式、sessionId]
    C13 -. 由购物助手调用时返回搜索结果 .-> TSearchResult[返回商品和意图给 ReAct 模型]
    SEmpty -. 由购物助手调用时返回空结果 .-> TSearchResult
    SErr -. 由购物助手调用时抛错 .-> A503[路由返回 503]
  end

  subgraph Shopping[自动购物助手：POST /api/v1/assistant/react]
    A0[助手页面提交 query] --> A1{已有登录会话？}
    A1 -- 否 --> A401[返回 401]
    A1 -- 是 --> A2[runShoppingReAct：创建带重试 LLM 客户端]
    A2 --> A3[ReAct 模型循环：最多 8 步，选择一个已注册工具]
    A3 --> TSearch[search_products：调用共享搜索入口，最多取 100 件并滤去无库存商品]
    TSearch --> C1
    TSearchResult --> A3
    A3 --> TSelect[select_recommended_product：按目录返回顺序取第一件有库存商品]
    A3 --> TCart[add_selected_to_cart：将所选商品加入 AI 购物车]
    A3 --> TQuote[quote_cart：重新校验库存并生成报价]
    A3 --> TSubmit[submit_order 工具]
    TSubmit --> TConfirm{confirmOrder 为 true？}
    TConfirm -- 否 --> TWait[返回 confirmation_required，不提交订单]
    TConfirm -- 是 --> TOrder[提交订单：要求 cartVersion 和 quoteId]
    TSearch -. 工具结果回到模型，模型决定下一步 .-> A3
    TSelect -. 工具结果回到模型，模型决定下一步 .-> A3
    TCart -. 工具结果回到模型，模型决定下一步 .-> A3
    TQuote -. 工具结果回到模型，模型决定下一步 .-> A3
    TWait -. 工具结果回到模型，模型决定下一步 .-> A3
    TOrder -. 工具结果回到模型，模型决定下一步 .-> A3
    A3 --> AFinal[final_answer：输出最终状态与文案]
    AFinal --> AOK[返回购物结果]
    A2 -. 未捕获异常 / 步数耗尽 .-> A503
  end

  subgraph Confirm[页面的显式确认：POST /api/v1/assistant/react/confirm]
    UConfirm[用户点击确认订单] --> O1{已有登录会话？}
    O1 -- 否 --> O401[返回 401]
    O1 -- 是 --> O2[校验 cartVersion、quoteId、幂等键]
    O2 --> O3[confirmShoppingOrder → submit_order 工具]
    O3 --> O4[交易服务校验授权、购物车与报价并提交]
    O4 --> O5[成功返回 ordered；失败返回提交错误]
  end
```

## 两个入口的职责

- **商品搜索入口**是确定性编排：会话上下文 → 意图解析（模型优先、正则降级）→ 意图合并 → 空意图短路或调用目录工具 → 成功时记录会话。它不加购、不报价、不下单。
- **自动购物入口**是 ReAct 编排：模型在每一步观察工具结果，再决定调用哪个工具；商品搜索通过 `searchProductsForAgent` 复用上面的搜索链路，之后可选商品、加购、报价，最后调用 `final_answer` 结束。
- 两者最终都通过 `invokeAgentTool` 和 MCP 工具层访问目录或交易服务；模型不直接访问数据库。

## 读代码时需要注意的现状

1. 搜索助手的会话保存在服务端进程内存中，最多保留最近 5 轮，30 分钟过期，最多 1000 个会话；进程重启或多实例切换可能丢失上下文。只有成功的非空搜索会写入一轮。
2. 意图合并发生在空意图判断之前。本轮没有新商品、品类、品牌词时会继承上一轮检索主体；因此复用同一 `sessionId` 时，闲聊式空意图也可能被合并成上一轮搜索。当前助手页面则没有跨轮保留或回传购物 `sessionId`。
3. 购物助手只请求目录第一页的最多 100 件候选，再取其中“第一件有库存”的商品；目录返回顺序由服务端排序决定，并不按价格选最低价。页面初始问候语所说的“挑选低价商品”与当前选择实现不一致。
4. ReAct 系统提示要求加购 1 件，但工具参数 schema 允许数量 1–10，执行函数本身没有把数量固定为 1。
5. 页面调用 `/react` 时只发送 `query`，未发送 `confirmOrder`，所以该路径实际按 `false` 运行并展示报价确认。用户点击确认后，页面走独立 `/react/confirm` 接口下单。仅传 `confirmOrder: true` 才会让 ReAct 中的 `submit_order` 工具尝试直接提交。
6. `needs_login`、`needs_authorization` 等状态出现在最终结果类型中，但 ReAct 路由先拦截未登录；交易工具的授权或报价失败会抛出异常并由路由作为失败响应处理，当前实现没有把这些错误统一转换成对应的最终状态。
7. ReAct 每轮最多 8 步，包含结束用的 `final_answer` 调用；模型传输调用有重试，实际有副作用的工具默认不会因执行错误自动重跑。搜索工具显式标记为可重试。
8. 搜索、选择、加购、报价和下单不是代码强制执行的固定流水线；模型根据系统提示在每步选择工具，工具只对部分前置条件做校验。图中的工具是预期路径，实际调用顺序由 ReAct 模型决定。

## 代码入口

- `app/api/v1/assistant/search/route.ts` → `lib/agent/search-products-agent.ts`
- `app/api/v1/assistant/react/route.ts` → `lib/agent/auto-shopping.ts` → `lib/llm/react.ts`
- `app/api/v1/assistant/react/confirm/route.ts` → `lib/agent/auto-shopping.ts` 的 `confirmShoppingOrder`
- 共用目录入口：`lib/agent/tool-registry.ts` → `lib/mcp/tool-calls.ts` → MCP Server / 目录或交易服务
