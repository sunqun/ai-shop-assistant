-- NULL表示旧订单没有保存当时名称，界面将明确标记，而非读取可能已改名的目录。
ALTER TABLE order_items ADD COLUMN product_name_snapshot VARCHAR(191) NULL AFTER sku_id;
