-- 上线前停止旧应用写入并完成/取消在途任务，再执行本迁移。
-- 仅移除被取消的交互模式字段；保留任务、订单、报价、幂等和用户绑定。
ALTER TABLE shopping_tasks DROP COLUMN mode;
