# AI 商城 Next.js 页面骨架

当前版本只搭建网页商城的 Next.js App Router 结构和页面路由，页面使用静态占位数据，不接入登录、商品、购物车、订单或 AI 业务接口。

## 启动

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。

## 已提供路由

- `/` 首页
- `/login`、`/authorize` 身份与授权入口
- `/products`、`/products/:productId` 商品列表和详情
- `/cart`、`/checkout` 购物车和结账入口
- `/handoff/:token` 交接入口
- `/account`、`/account/orders`、`/account/logistics`、`/account/refunds`、`/account/authorizations` 我的中心
- `/orders/:orderGroupId` 及其 `logistics`、`result`、`returns` 子页面

## 验证

```bash
npm run typecheck
npm run build
```
