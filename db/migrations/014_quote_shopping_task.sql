-- 报价绑定服务端购物任务，C 优惠只授予自动任务。
ALTER TABLE cart_quotes ADD COLUMN shopping_task_id CHAR(36) NULL AFTER selected_sku_ids;
