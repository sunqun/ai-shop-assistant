# 后端技术文档

## 架构

`POST /api/v1/assistant/react` 读取登录会话，创建 LLM ReAct 循环。循环只可调用注册工具：`search_products`、`select_recommended_product`、`add_selected_to_cart`、`quote_cart`、`submit_order` 和 `final_answer`。

LLM 负责选择下一步；目录 MCP 返回已按服务端推荐顺序排列的商品，购物 Agent 从中保序选择第一件有库存商品，不再按价格重排。推荐分数及其内部计算字段不进入工具响应；库存、价格、购物车、报价和订单均由现有目录/MCP/交易服务负责。`final_answer` 是带 schema 校验的终止工具，最大执行步数为 8。

## 安全与一致性

- 订单工具要求登录和 AI 下单授权。
- 提交订单前必须重新使用购物车版本和报价 ID。
- 交易工具继续执行库存锁定、报价有效期、幂等键和价格复核。
- `confirmOrder=false` 时只允许完成搜索、加购和报价，不创建订单。
- 模型不能直接访问数据库或自行生成商品和金额。

## 接口

请求：`{ query: string, sessionId?: string, confirmOrder?: boolean }`。

返回：`status`、`message`，以及工具产生的 `product`、`quote` 或 `order`。未登录返回 401，流程或工具暂不可用返回 503。
