# 付款后刷新商品库存改动记录

- 日期：2026-11-16（Asia/Shanghai）
- 需求来源：用户反馈付款后商品库存未及时更新，要求付款成功后重新请求相关商品数据。

## 改动概要

- 商品目录查询改用 `inventory_skus.on_hand - reserved` 计算实时可售库存，搜索的“有库存”条件也使用同一表达式。
- AI 助手付款成功后调用商品详情接口重新读取商品数据，并同步更新搜索结果和已打开的商品详情。
- 订单已经成功但刷新请求失败时，保留订单成功状态并提示用户稍后刷新，避免把刷新故障误报为付款失败。
- 付款处理中状态绑定到当前商品；点击某一商品后仅该行显示“处理中...”，其余商品不再一起变化。

## 涉及文件

- `lib/catalog.ts`
- `components/assistant-dock.tsx`
- `app/api/v1/products/detail/route.ts`
- `testLibrary/m5-commerce/catalog-inventory.test.ts`
- `testLibrary/m5-commerce/assistant-inventory-refresh.test.tsx`

## 验证

- `npm test`：通过，7 个测试文件、18 个测试用例通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过，无错误；购物车页面存在 3 条未使用变量警告。
- `git diff --check`：仅报告工作区原有的 `app/cart/page.tsx:348` 行尾空白，以及 Git 的 LF/CRLF 转换提示；本次未清理无关文件。

## Review 结论与遗留风险

静态审查未发现本次刷新逻辑中的 P0/P1 问题。真实 MySQL 集成和并发扣库存测试仍需在可用数据库环境中执行。
