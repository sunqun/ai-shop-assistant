# M2 首页商品列表与加购改动记录

## 改动概要

依据 `docs/v0.1.0/module-delivery-splitting.md` 的 M2 新需求，将首页改为商品列表，移除 `/products` 列表路由，保留 `/products/:productId` 商品详情，并补齐购物车本地恢复、编辑和移除能力。首页右侧嵌入式 AI 助手占据固定布局列，支持 TOP3、独立结果滚动、收起和可拖动入口。

## 需求来源

- M2：`/` 商品列表、搜索筛选、下拉增量加载、商品详情、规格/数量加购、购物车查看编辑移除。
- 首页助手：默认展开并占据页面位置，不遮挡商品；收起后显示可拖动入口。

## 改动文件

- `app/page.tsx`
- `app/products/[productId]/page.tsx`
- `app/products/page.tsx`（删除）
- `app/cart/page.tsx`
- `app/account/orders/page.tsx`
- `components/assistant-dock.tsx`
- `app/layout.tsx`
- `components/page-shell.tsx`
- `app/globals.css`
- `lib/products.ts`

## 验证

- 时间：2026-11-15 Asia/Shanghai。
- `npm run typecheck`：通过。
- `npm run build`：通过；仅有 CSS autoprefixer 关于 `align-items` 旧值的非阻断警告，已改为 `flex-start`/`flex-end`。
- 路由检查：构建产物包含 `/`、`/cart`、`/products/[productId]`，不包含 `/products`。
- 测试用例：`docs/v0.1.0/cases/2026-11-15-m2-homepage/m2-homepage-test-cases.md`。
- 浏览器交互验证：已覆盖首页进入详情、规格与数量加购、购物车恢复/编辑/移除、搜索、品类筛选、价格排序、无匹配空状态、收起助手入口拖动以及 `/products` 404；详细结果见 M2 测试用例文档。

## Code review 结论

发现并修复：本地购物车 JSON 损坏导致加购异常、详情页未使用所选规格/数量、重复加购未限制库存；同时补充购物车数据校验和助手入口拖动边界。

## 遗留风险

- 当前商品和购物车仍使用演示数据与 `localStorage`，尚未接入 M2 后端商品/购物车接口、cursor 服务端分页、库存服务端校验或跨设备同步。
- 当前 in-app browser 视口约为 623×613，尚未使用 >= 1200px 的独立桌面浏览器截图复核助手固定列布局；CUA 隔离环境无法直接注入损坏 `localStorage` JSON，因此 M2-T04 仅完成代码路径验证。
