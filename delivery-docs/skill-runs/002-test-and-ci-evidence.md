# 使用记录 002：计价测试与 CI 证据审查

## 本次使用

- Skill：`shop-pricing-audit`，版本 `0.2.0`，同时读取其 `references/evidence-checklist.md`。
- 使用方式：本次开发会话中，同一 AI 助手针对另一项明确范围的审查显式读取并使用新版；不是第二位用户或独立评测者调用。
- 源码/截图取证时间：2026-11-21 05:44:49～05:44:53 UTC；报告在取证后形成。
- 源码基线 commit：`fb7695c447db21ac87f7d8c195c4563b4309dc56`，并以读取的当前工作区为准；不将它认定为截图对应commit。
- Skill入口 SHA-256：`DE8C87AB0A8B981AE03A05EFB5C606743EF90675E0BF2C8C59BB45D5DBAE0E78`。
- 清单 SHA-256：`7D90C1864879328E9C765CBA7F8FBFA50B09485F73482301E9571A75596D393D`。
- 版本快照：[v0.2.0/SKILL.md](../skill-versions/shop-pricing-audit/v0.2.0/SKILL.md)。
- 任务：核对金额输入/资格/展示、测试断言与现有CI截图的证据范围，不运行测试、不访问线上运行、不修改图片和业务代码。

## 输入、资格与展示矩阵

| 入口/环节 | 输入与资格来源 | 输出或校验 | 证据等级 |
| --- | --- | --- | --- |
| 网页报价 | 服务端目录单价、可分配量、可选勾选集合；用户身份来自session；`quoteCart`读取账号A使用历史 | 同一计价函数返回分单位报价；网页摘要目前整元显示 | 源码支持，未运行 |
| Agent报价 | 共用`quoteCart`，购物车来源AI；C资格另查服务端自动任务，不接受客户端自行声明 | 没有有效自动任务时不能仅靠AI来源获得C | 源码支持；已有mock断言 |
| 下单重校验 | 当前规则版本、账号历史、任务绑定和报价金额 | 同一`calculateBestQuote`再次验证，资格变化拒绝旧报价 | 源码支持；已有mock断言 |
| UI金额展示 | `cartTotal.tsx`用Math.round取整，助手消息使用Intl货币格式化 | 带小数金额存在显示差异风险；不是另一份优惠公式 | 源码推导，未执行界面复现 |

主要代码证据：[`quote-service.ts`](../../lib/repository/quote-service.ts) 的 `selectedSkuIds`、`promotionAAvailable`、`eligibleC` 和 `calculateBestQuote`；[`promotion-eligibility.ts`](../../lib/repository/promotion-eligibility.ts)；[`cartTotal.tsx`](../../app/cart/cartTotal.tsx)；[`assistant-messages.tsx`](../../app/assistant/assistant-messages.tsx)。

## 测试与 CI 证据

| 检查项 | 实际读取内容 | 可支持结论 | 不能支持的结论 |
| --- | --- | --- | --- |
| 测试命令 | [`package.json`](../../package.json)：npm test=vitest run；[`vitest.config.mts`](../../vitest.config.mts)：发现test.ts/tsx | 有可执行自动化测试入口 | 本轮已经执行测试 |
| 金额领域 | [`domain.test.ts`](../../testLibrary/domain/domain.test.ts)：12个用例中4个库存、8个价格 | 有金额转换/小计/门槛/非法值等断言 | 将12个全计作价格用例 |
| 优惠边界 | [`original-promotions.test.ts`](../../testLibrary/domain/original-promotions.test.ts)：参数表8项+4个普通用例 | 有12项优惠边界/资格断言 | 这些口径已经获业务批准 |
| 服务层资格 | [`promotion-consumption.test.ts`](../../testLibrary/ommerce/promotion-consumption.test.ts)：mock数据库和目录 | 有13项资格、报价/下单复核及重试等断言；截图显示该文件通过 | 真实MySQL事务/锁竞争已通过 |
| GitHub工作流 | [ci.yml](../../.github/workflows/ci.yml)：main/dev的push/PR，依次typecheck/test/lint/build | 配置了执行Test的流程 | 任意分支或当前commit已经执行成功 |
| 已有截图 | 只读查看[`price-test-1.png`](../images/price-test-1.png)、[`price-test-2.png`](../images/price-test-2.png) | 该次Job和Test成功，测试文件31 passed/1 skipped；三份相关文件显示12/12/13个用例通过 | 截图未展示的完整用例总数或commit一致性 |
| 数据库集成开关 | [`shopping-tasks.integration.test.ts`](../../testLibrary/ommerce/shopping-tasks.integration.test.ts) 用 `SHOPPING_TASK_DB_TEST=1` 开启；当前CI未配置 | 截图显示该文件12条用例跳过，与开关吻合 | 把跳过的12条写成已执行通过 |

## 发现与建议

1. **计价复用有静态支持**：输入/资格不同与共用公式并不冲突，当前相关服务测试也是调用共用实现，没有复制另一套公式。
2. **CI执行范围已有截图证据，但源码版本关联未核验**：截图中的成功可以记录；当前材料没有可从截图直接读出的commit，且本轮未访问线上运行，建议提交时补可核对的运行链接和对应SHA。不能将工作区基线SHA自动填成截图SHA。
3. **真实数据库验证未覆盖**：服务测试mock不替代真实MySQL；12条显式跳过的集成用例保留为未执行范围。
4. **业务批准另列**：[`DECISIONS.md`](../DECISIONS.md) 中优惠规则仍为待确认，标记 `needs_human_review`；代码和测试存在不改变其批准状态。
5. **展示精度风险保留**：沿用记录001发现，待确认小数显示口径后再做独立修改和验证。本次没有修改业务代码。

## 执行边界与新版效果

本轮完成的是skill静态审查使用，不是Vitest执行；没有运行项目测试、CI、数据库、模型或支付。已有图片只读，未修改。新版按证据等级分别表述了源码、断言、mock、截图和未核验版本，避免了将一次成功截图扩大为所有环境和当前版本均已验收。
