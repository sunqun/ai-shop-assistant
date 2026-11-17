# AI 商城

Next.js App Router 网页商城。结账页点击“付款”会创建并持久化订单记录；本期不接入支付，也不处理物流、发货、收货、扣款、退货或退款。“我的”页面提供本人订单列表。

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
- `/account`、`/account/orders` 我的中心及订单记录
- `/orders/:orderGroupId` 订单记录详情与创建回执

## 验证

```bash
npm run typecheck
npm run build
```

订单记录写入 MySQL，需先按 `db/migrations/` 初始化数据库并配置项目所需的数据库环境变量。

### Railway 数据库初始化

在 Railway 的 MySQL 服务中打开 Query/Console，按文件名顺序执行 `db/migrations/` 下的 SQL。商品目录必须先执行 `002_create_products.sql`，再执行 `003_create_categories.sql`；如果此前执行 `003_create_categories.sql` 时因 `products` 不存在而失败，先执行商品迁移，再重新执行分类迁移。
