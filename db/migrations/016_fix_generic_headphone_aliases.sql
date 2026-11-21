-- 通用耳机别名不能限定为无线蓝牙耳机，否则会漏掉头戴式等同类商品。
-- 仅停用已知的错误映射；保留具体类型别名和其他运营配置，可重复执行。
START TRANSACTION;

UPDATE product_search_aliases
   SET is_active = FALSE
 WHERE alias IN ('耳机', '耳機', '耳機子')
   AND canonical_term = '無線藍牙耳機';

INSERT INTO product_search_aliases (alias, canonical_term, is_active) VALUES
  ('耳机', '耳機', TRUE),
  ('耳機', '耳機', TRUE),
  ('耳機子', '耳機', TRUE)
ON DUPLICATE KEY UPDATE is_active = TRUE;

COMMIT;
