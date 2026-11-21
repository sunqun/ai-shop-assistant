# 使用记录 001：统一计价调用链审查

## 本次使用

- Skill：`shop-pricing-audit`，版本 `0.1.0`。
- 使用方式：本次开发会话中，由创建该 skill 的 AI 助手显式读取并按其步骤完成静态审查；不是独立用户调用或历史使用记录。
- 源码取证时间：2026-11-21 05:41:12～05:43:04 UTC；报告在取证后形成。
- 源码基线 commit：`fb7695c447db21ac87f7d8c195c4563b4309dc56`，并以本次读取的工作区为准。
- 使用版本 SHA-256：`3BEE7E1665AF8BDD2DC89D2B3D0A2AA4223A4A5586F1E853673F6DCF932D09AB`。
- 版本快照：[v0.1.0/SKILL.md](../skill-versions/shop-pricing-audit/v0.1.0/SKILL.md)。
- 任务：审查网页、Agent 报价及下单重校验是否共用价格实现，记录证据，不修改业务代码、不运行测试。

## 执行过程与证据

实际读取了 skill 入口、计价函数、报价/下单服务、优惠资格、MCP 转发、网页/Agent 金额展示及相关测试源文件；使用 `rg` 查询调用和关键金额公式。

| 检查项 | 源码证据 | 观察 |
| --- | --- | --- |
| 网页报价 | [`carts/quote/route.ts`](../../app/api/v1/carts/quote/route.ts)，`quoteCart` 调用处约第40行 | 传 `expectedSource: WEB` 及勾选SKU集合，进入共用服务 |
| Agent 报价 | [`assistant/cart/quote/route.ts`](../../app/api/v1/assistant/cart/quote/route.ts) → [`tool-calls.ts`](../../lib/mcp/tool-calls.ts) → [`commerce-server.ts`](../../lib/mcp/commerce-server.ts)，后者约第161行 | 工具转发 `expectedSource: AI` 及服务端任务上下文，调用同一个 `quoteCart` |
| 共用计算 | [`quote-service.ts`](../../lib/repository/quote-service.ts)，约第101～112行 → [`pricing-domain.ts`](../../lib/pricing-domain.ts) | 行小计复用 `lineSubtotalMinor`，最终金额复用 `calculateBestQuote` |
| 下单再校验 | [`order-service.ts`](../../lib/repository/order-service.ts)，约第84～104行及两类建单调用处 | `assertQuotePromotions` 再调用统一价格函数，不是另写公式 |
| 公式扫描 | 在 `app/`、`components/`、`lib/` 搜索5%/95%、1000/990门槛及运费赋值 | 这些关键公式命中 `pricing-domain.ts`；限定扫描范围内未发现复制到入口的另一套公式 |
| 已有测试 | [`domain.test.ts`](../../testLibrary/domain/domain.test.ts)、[`original-promotions.test.ts`](../../testLibrary/domain/original-promotions.test.ts) | 已读到小计、门槛、资格和金额断言；没有执行这些用例 |

## 结论与问题

1. **静态证据支持共用计价实现**：限定入口均追踪到 `calculateBestQuote`；多次调用不等于多份实现。关键字扫描不是整个仓库所有可能公式的形式证明。
2. **输入资格并不相同**：`promotion-eligibility.ts` 使用账号历史和服务端自动任务判断优惠资格。不能要求 WEB 和 AI 无条件得到同一总价，也不能仅看 `source=AI` 就判定可用自动任务优惠。
3. **P2，展示精度存在差异，待确认**：[`app/cart/cartTotal.tsx`](../../app/cart/cartTotal.tsx) 用 `Math.round(value / 100)` 展示整元，助手消息使用货币格式化保留小数。同一个带小数金额可能显示不同；这是源码推导，未运行界面验证，也不是重复的价格公式。后续应明确展示精度口径再评估修复。

## 未执行范围

未执行 Vitest、类型检查、lint、构建、数据库、模型请求、HTTP建单或支付；未核验线上CI对应commit。终端在源码审查前发生沙箱初始化失败，随后通过获准的只读命令完成读取；没有把该环境失败记成业务测试失败。

## 对 skill 的迭代反馈

初版能完成调用链和公式检查，但报告中“公式统一”“资格不同”“展示精度不同”仍需临时组织说明。下一版应规定输入/资格/展示的独立证据项，并在核对测试时提供明确的源码、mock、截图和真实执行证据分类，避免只列测试文件就使交付结论过大。
