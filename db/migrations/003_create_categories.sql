-- 品类维度化：新增 categories 表，products 从 category 字符串改为 category_id 外键
CREATE TABLE IF NOT EXISTS categories (
  category_id VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  tone VARCHAR(32) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO categories (category_id, name, tone, sort_order) VALUES
  ('3c-accessories', '3C 配件', 'office', 1),
  ('home-living', '居家生活', 'home', 2),
  ('beauty', '美妝保養', 'media', 3),
  ('sports-outdoor', '運動戶外', 'fitness', 4),
  ('food-drink', '食品飲料', 'kitchen', 5);

ALTER TABLE products
  ADD COLUMN category_id VARCHAR(32) NULL AFTER category,
  ADD CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (category_id);

UPDATE products SET category_id = CASE category
  WHEN '3C 配件' THEN '3c-accessories'
  WHEN '居家生活' THEN 'home-living'
  WHEN '美妝保養' THEN 'beauty'
  WHEN '運動戶外' THEN 'sports-outdoor'
  WHEN '食品飲料' THEN 'food-drink'
  ELSE NULL END;

ALTER TABLE products
  MODIFY category_id VARCHAR(32) NOT NULL,
  DROP COLUMN category;
