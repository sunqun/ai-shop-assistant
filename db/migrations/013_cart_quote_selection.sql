-- NULL 表示旧报价/整车报价；数组表示本次报价绑定的勾选商品。
ALTER TABLE cart_quotes ADD COLUMN selected_sku_ids JSON NULL AFTER cart_version;
