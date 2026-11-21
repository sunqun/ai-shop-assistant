# 验证与计价一致性审查

> 当前界面已按用户后续澄清改为“对话内展示差异和报价、输入框上方确认操作行”，并取消周期状态轮询。文中的首次模态确认验证保留为历史执行记录，当前修订验证见文末。

日期：2026-11-21（Asia/Shanghai）。使用 `shop-pricing-audit` 技能 v0.2.0。基线为 HEAD `fb7695c` 加本次未提交工作区改动；本报告不代表该 commit 或本次工作区已通过远程 CI。

## 范围和业务确认

覆盖网页报价、AI 独立报价、AI 对话任务报价及下单校验。用户已明确批准：当前 AI 对话框的任务下单享有 C，包括中途确认商品差异的流程；独立网页/短链不因 AI 来源自动获得 C。

| 入口 | 金额输入 | C 资格来源 | 展示与提交 |
| --- | --- | --- | --- |
| 网页购物车报价 | 服务端商品单价、勾选 SKU、实际分配数量 | 不授予对话任务资格 | 消费服务端报价，提交重新校验 |
| AI 独立购物车报价 | 同一报价服务，AI 来源购物车 | 无服务端对话任务绑定时无 C | 不能挪用任务报价绕过任务确认/取消屏障 |
| 当前 AI 对话任务 | 同一报价服务、服务端任务 ID、当前用户 | isConversationShoppingTask 按 task_id/userid 查询 | 无差异自动推进；有差异接受当前完整报价后提交 |

实际调用链：网页 Route → quoteCart → calculateBestQuote；对话任务 → 受控 ReAct → MCP quote_cart → quoteCart → calculateBestQuote；任务确认/自动提交 → submitAiOrder → assertQuotePromotions → calculateBestQuote。

源码证据：`lib/repository/quote-service.ts`、`lib/repository/order-service.ts`、`lib/repository/promotion-eligibility.ts`、`lib/pricing-domain.ts`、`lib/shop-task/shopping-task-service.ts`。商品行金额继续复用 lineSubtotalMinor/toMinor，以整数分计算；商品差异比较的 toMinor 是金额转换，不是第二套优惠公式。

搜索 `lib/`、`app/` 中 0.05、0.95、满减/运费阈值及计算函数调用，在本轮检索和已追踪链路内未发现新增的满减、C 折扣或运费公式副本。规则版本已更新为 promotions-2026-11-21-v4，旧资格口径下的报价须重新获取。

## 已实际执行

最终隔离测试开始时间：2026-11-21 17:02:28（Asia/Shanghai）。报告位于工作区 `out/unified-shopping-tests.json`。

| 检查 | 结果与范围 |
| --- | --- |
| `SHOPPING_TASK_DB_TEST=0 npm test -- --reporter=json --outputFile=out/unified-shopping-tests.json` | 发现 35 个文件；357 条通过、0 失败、12 条跳过。跳过项全部位于 shopping-tasks.integration.test.ts，是真实 MySQL 行锁集成用例，不能计为通过。 |
| `npm run typecheck -- --incremental false` | 通过 |
| `npm run lint` | 通过 |
| `npm run build` | 通过；生产输出 .next，开发输出 .next-dev 继续隔离 |
| 浏览器夹具检查 | 无头 Edge，全部 API 拦截为本地夹具；1440×1000 和 1100×800 的确认窗口无横向溢出、无页面脚本错误，接受按钮只发送一次绑定展示报价的请求，成功后窗口关闭。 |
| 本地 HTTP | 首页和 /assistant 为 200；未登录 GET /api/v1/assistant/tasks 为 401；已删除的独立 ReAct 与确认路径为 404。 |
| 清理检索及差异检查 | 当前运行时及用例中未再发现 ShoppingMode、submissionMode、旧模式参数/分支、预报价 select_product 接受路径或独立 confirmShoppingOrder。git diff --check 通过。 |

替换了失效的“手动/自动模式各自行为”、独立模型建单及“选品后再报价再确认”用例；保留并更新幂等、取消、恢复、数量、名称快照、优惠核销等仍有效的业务覆盖。新增目录完整集合扫描、推荐顺序、预算/品牌/续航/排除差异、未知规格、库存数量、差异接受快照及弹窗回归。

## 未执行和发布前置

上述 17:02 验证没有访问真实模型、真实 MySQL、线上环境或实际建单，当时未执行数据库迁移，也未提交或推送代码。mock/浏览器夹具通过不代表真实数据库锁竞争或生产模型行为已验收。后续用户单独授权的本地迁移执行结果见下一节。

已有数据库先检查 011–014 等所需迁移及目标库，完成/取消在途任务并停止旧版本写入，再执行 `015_unified_conversation_tasks.sql` 并发布新版。全新数据库使用最终 `db/ddl.sql`，不再重复执行已经内联的历史迁移。历史迁移保留原始结构，015 负责真实升级时删除 mode 列；没有运行时兼容字段。

## 后续本地迁移执行记录

2026-11-21 18:11（Asia/Shanghai），用户明确授权执行本地 015 迁移后，已在 `127.0.0.1:3306/ai_shop` 执行 `ALTER TABLE shopping_tasks DROP COLUMN mode`。

执行前核对：目标主机、端口、数据库名均与授权一致；在途购物任务为 0；旧 mode 列为 NOT NULL 且无默认值，与新版不再写入该列的任务 INSERT 不兼容。

执行后核对：mode 列已删除，其余列名及顺序不变；shopping_tasks 仍为 6 条，order_groups、orders、order_items 均仍为 26 条，执行前后记录数一致。执行记录保存在 `out/migration-015-local-result.json`。

本次仅变更已授权本地数据库结构，未调用真实模型、未发起购物或建单，也未执行线上数据库迁移。接口完整购物流程仍需由用户重新发送需求验收。

## 对话内确认与按需查询修订

根据用户澄清，删除 `AssistantConfirmation` 模态组件、专属样式和原生 dialog 测试桩。商品、数量、差异及完整报价直接显示于对话记录；输入框上方恢复“取消并生成短链 / 确认下单”操作行，用户也可在正常输入框回复“帮我下单”。后端的差异接受快照、报价绑定、幂等及优惠 C 资格不变。

删除固定 800ms 周期 GET。正常推进、确认、取消使用操作接口响应；页面恢复、断连核对及手动刷新才读取状态。等待用户确认不发起连续查询，长请求期间显示统一加载；失败后只核对一次状态并暂停自动重试，避免 queued 状态产生新的请求循环。恢复到仍在处理的任务时提供手动“刷新进度”。

最终隔离测试开始时间：2026-11-21 18:33:52（Asia/Shanghai），报告 `out/inline-confirmation-tests.json`：36 个文件，364 条通过、0 失败、12 条真实 MySQL 集成用例跳过。TypeScript、ESLint、生产构建均通过。

浏览器夹具检查在 1440×1000 和 1100×800 下确认：无模态窗口，普通输入框可用；确认行位于输入框上方，差异及报价在聊天区，无横向溢出；等待 2.4 秒及确认提交后，任务 GET 总数始终为初始恢复时的 1 次。确认只发送 1 次提交请求，直接使用响应显示订单结果，页面脚本错误为 0。记录 `out/unified-inline-browser-results.json`，截图 `out/unified-inline-1440.png`、`out/unified-inline-1100.png`。

本次修订未访问真实模型或数据库，浏览器 API 全部由本地夹具拦截，未实际建单；此前经用户授权执行的本地 015 迁移记录保持不变。
