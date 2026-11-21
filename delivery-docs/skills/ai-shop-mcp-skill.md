---
name: shop-shopping
description: 当用户表达购物/购买/下单意图（如「我要买一个蓝牙耳机」「帮我下单」「给我买X」）时，通过 ai-shop-mcp 提供的 shop_* 工具完成「登录 → 搜索 → 加购 → 报价 → 下单」闭环。不用于修改业务代码或本地开发调试。
---

# AI 商城交互式购物（通过 MCP）

通过已连接的 ai-shop-mcp（SSE）调用 `shop_*` 工具，完成一次真实购物。

## 前置条件

- 已连接 ai-shop-mcp 的 SSE 端点（默认 `http://localhost:8079/sse`，端口由 `PORT` 决定）。
- 商城地址由 `SHOP_BASE_URL` 决定（默认 `http://localhost:3000`），需已运行且可访问。

## 购物流程（工具调用顺序）

1. `shop_login`：登录（默认走登录并自动完成 AI 自助下单授权、保存会话 Cookie）。若用户没有账号，传 `register: true` 先注册。
2. `shop_search`：用自然语言搜商品，从返回的 `products` 里挑一个 `stock > 0` 的商品，记下 `id`。
3. `shop_add_to_cart`：传 `items: [{ id, quantity }]`，`idempotencyKey` 用时间戳保证唯一。从返回取 `cartVersion`。
4. `shop_quote`：传上一步的 `cartVersion`，从返回的 `quote.quoteId` 取 `quoteId`。
5. `shop_submit_order`：传 `cartVersion` + `quoteId` + 新的 `idempotencyKey`。返回 `orderGroupId` 即下单成功。

## 关键注意

- `cartVersion`、`quoteId` 必须原样沿链路传递，缺一或过期会报 `CART_CHANGED` / `QUOTE_EXPIRED` 等。
- 每次 `idempotencyKey` 必须唯一，重复会被拒绝（409 `IDEMPOTENCY_KEY_REUSED`）。
- 中文搜索由 MCP 服务端按 UTF-8 处理，无需额外编码。
- 下单前若返回 `AUTHORIZATION_REQUIRED`，说明授权未完成，重新 `shop_login`（登录会自动授权）。

## 可选工具

- `shop_create_payment_link`：为单商品生成支付短链。
- `shop_read_reviews`：分页读取商品公开评论。
