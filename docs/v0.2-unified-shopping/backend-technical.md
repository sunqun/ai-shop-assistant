# 后端技术文档

日期：2026-11-21。用户已批准统一自动流程及“当前 AI 对话任务含中途确认均享有 C”的业务规则。

## 目录与差异

普通目录搜索保留既有过滤与分页；对话任务通过 `includeAlternatives` 调用 `searchShoppingProducts()`，保持商品主体范围，扫描完整的同类有货匹配集合。

SQL 继续按 `internal_rank DESC, product_id ASC` 及稳定游标读取，内部加权表达式沿用 `lib/catalog/shared.ts`，不复制排序或价格规则。优先返回第一个全部满足的商品；仅当扫描结束仍无完整匹配，返回首个有差异的候选。

`ProductDifference` 保存 requirement、actual、status（not_met/unverified）。品牌、预算、评分、数值规格及排除条件由目录事实核对；自然语言条件继续验证模型引用证据。未知或含混规格须标注无法核实。商品与工具返回中不包含毛利、推荐分或内部加权细节。

## 任务状态机

移除 `ShoppingMode`、请求 mode、任务 mode、相关分支及旧独立 ReAct 建单/确认接口。ReAct 必须接收任务控制钩子，只允许准备商品与报价，不暴露建单工具。

准备成功且 differences 为空进入 ready_to_order；否则进入 awaiting_confirmation，无自动提交截止时间。有差异时普通 advance 不能提交。精确命令或按钮必须匹配当前任务、quoteId、cartVersion；行锁内保存 acceptedQuote，绑定商品、数量、差异与接受时间，随后取得提交令牌，锁外提交。

保留 revision、operationToken、用户范围、幂等键、库存消费事务、报价核销和恢复状态。无差异自动提交仍遵守服务端截止时间。评论分析暂停和恢复不再依赖任何交互模式。

## 优惠与订单来源

`isConversationShoppingTask()` 按 task_id 和 userid 校验服务端任务。报价与提交都使用同一资格判断，C 不取决于中途是否出现确认。没有绑定对话任务的 AI 来源购物车不享有 C；任务报价仍只能按绑定任务的幂等键提交。

全部金额继续由 quoteCart → calculateBestQuote 计算，规则版本更新为 promotions-2026-11-21-v4，使旧资格口径下的报价失效。订单展示使用经用户、报价任务与幂等键共同核实的 shoppingTaskId 表示对话来源，删除 submissionMode，不能仅凭 source=AI 推断为对话下单。

## 数据库与发布

新增 `015_unified_conversation_tasks.sql` 删除 shopping_tasks.mode；全量 `ddl.sql` 同步最终结构。已交付的 011 等迁移保留历史事实，按升级顺序应用 015，不重写历史迁移。

发布前停止旧版本写入并完成/取消在途任务，再应用迁移并发布新版；勿把旧的差异接受过程推断为新流程授权。迁移文件生成不代表已在任何目标数据库执行。应用不自动补表或兼容缺失迁移。

## 验证

更新目录候选、差异、精确确认、报价失效、取消短链、优惠 C、订单来源及界面回归覆盖。测试默认 mock 数据库和模型；真实 MySQL 行锁集成测试仅在明确授权的隔离库中开启。真实支付仍不在本期范围。
