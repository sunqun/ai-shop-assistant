# AI 商城

Next.js App Router 网页商城。结账页点击“付款”会创建并持久化订单记录；本期不接入支付，也不处理物流、发货、收货、扣款、退货或退款。“我的”页面提供本人订单列表。

## 启动

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。

## 验证

```bash
npm run typecheck
npm run build
```

订单记录写入 MySQL，需先按 `db/migrations/` 初始化数据库并配置项目所需的数据库环境变量。

生产环境至少需要配置 `AUTH_SESSION_SECRET`，以及以下任一组 MySQL 连接变量：

- `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`
- Railway 默认变量 `MYSQLHOST`、`MYSQLPORT`、`MYSQLDATABASE`、`MYSQLUSER`、`MYSQLPASSWORD`
- `MYSQL_URL` 或 `DATABASE_URL`（格式为 `mysql://用户名:密码@主机:端口/数据库名`）

应用会优先使用带下划线的变量，其次读取 Railway 变量和连接 URL。数据库未初始化 `users` 表时，注册接口会返回 503；部署后请确认已执行 `db/migrations/001_create_users.sql`（或完整执行所有迁移）。

### Railway 数据库初始化

在 Railway 的 MySQL 服务中打开 Query/Console，按文件名顺序执行 `db/migrations/` 下的 SQL。商品目录必须先执行 `002_create_products.sql`，再执行 `003_create_categories.sql`；如果此前执行 `003_create_categories.sql` 时因 `products` 不存在而失败，先执行商品迁移，再重新执行分类迁移。
