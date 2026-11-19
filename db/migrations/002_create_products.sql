-- 商品目录基础表。
-- 该迁移需要在 003_create_categories.sql 之前执行；003 会把 category
-- 转换为 category_id 外键。
CREATE TABLE IF NOT EXISTS products (
  product_id VARCHAR(100) NOT NULL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  brand VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'TWD',
  margin_rate DECIMAL(5, 4) NOT NULL DEFAULT 0,
  recommendation_score DECIMAL(8, 2) NOT NULL DEFAULT 0,
  specs JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_category (category),
  INDEX idx_products_recommendation (recommendation_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_reviews (
  review_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id VARCHAR(100) NOT NULL,
  reviewer_name VARCHAR(100) NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_reviews_product FOREIGN KEY (product_id) REFERENCES products (product_id) ON DELETE CASCADE,
  CONSTRAINT chk_product_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  INDEX idx_product_reviews_product_date (product_id, reviewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO products
  (product_id, name, brand, category, description, price, currency, margin_rate, recommendation_score, specs)
VALUES
  ('desk-kit', '智能办公套装', 'AI Shop', '3C 配件', '桌面支架、无线键鼠与 USB-C 扩展，一套整理高效工作区。', 899.00, 'TWD', 0.42, 82.00, JSON_OBJECT('配置', '无线键鼠、USB-C 扩展、铝合金支架')),
  ('airbuds-pro', '降噪蓝牙耳机 Pro', 'AI Shop', '3C 配件', '自适应降噪与通透模式，通勤和专注都保持清晰听感。', 699.00, 'TWD', 0.40, 78.00, JSON_OBJECT('功能', '主动降噪', '续航', '32 小时', '连接', '双设备连接')),
  ('travel-pack', '轻量旅行背包', 'AI Shop', '運動戶外', '20L 分区收纳、防泼水面料，适合短途出行与日常通勤。', 459.00, 'TWD', 0.35, 72.00, JSON_OBJECT('容量', '20L', '材质', '防泼水', '收纳', '电脑隔层')),
  ('air-fryer', '低脂空气炸锅', 'AI Shop', '食品飲料', '可视化烹饪窗口与一键菜单，少油也能做出酥脆口感。', 329.00, 'TWD', 0.30, 69.00, JSON_OBJECT('容量', '4L', '功能', '可视窗口、八种菜单')),
  ('desk-lamp', '护眼智能台灯', 'AI Shop', '居家生活', '无频闪光源、色温亮度可调，为工作和阅读提供舒适照明。', 239.00, 'TWD', 0.38, 74.00, JSON_OBJECT('功能', '无频闪、色温可调、定时关闭')),
  ('fitness-watch', '运动健康手表', 'AI Shop', '運動戶外', '全天候心率与睡眠监测，支持多种运动模式和来电提醒。', 799.00, 'TWD', 0.32, 76.00, JSON_OBJECT('续航', '7 天', '防水', '50 米', '功能', 'GPS 定位')),
  ('coffee-maker', '磨豆咖啡机', 'AI Shop', '食品飲料', '内置锥刀磨豆器，支持浓度记忆和一键萃取。', 1280.00, 'TWD', 0.45, 80.00, JSON_OBJECT('功能', '现磨现煮、浓度记忆', '容量', '可拆水箱')),
  ('webcam', '4K 会议摄像头', 'AI Shop', '3C 配件', '自动构图和双麦克风降噪，远程会议保持自然清晰。', 589.00, 'TWD', 0.36, 71.00, JSON_OBJECT('画质', '4K', '功能', '自动构图、双麦降噪')),
  ('suitcase', '静音万向行李箱', 'AI Shop', '運動戶外', '耐刮箱体和静音万向轮，轻松应对周末和长途旅程。', 629.00, 'TWD', 0.34, 65.00, JSON_OBJECT('尺寸', '20 吋', '功能', '静音万向轮、TSA 海关锁')),
  ('air-purifier', '桌面空气净化器', 'AI Shop', '居家生活', '小空间快速循环净化，低噪运行适合卧室与办公桌。', 399.00, 'TWD', 0.31, 68.00, JSON_OBJECT('滤网', 'HEPA', '功能', '低噪运行、滤芯提醒')),
  ('tablet', '轻薄学习平板', 'AI Shop', '3C 配件', '高亮护眼屏与长续航，适合阅读、学习和轻办公。', 1599.00, 'TWD', 0.28, 83.00, JSON_OBJECT('屏幕', '11 吋', '存储', '128GB', '功能', '手写笔支持')),
  ('yoga-mat', '防滑瑜伽垫', 'AI Shop', '運動戶外', '双层缓震结构和稳定抓地力，适合瑜伽、拉伸与居家训练。', 189.00, 'TWD', 0.40, 70.00, JSON_OBJECT('厚度', '6mm', '功能', '防滑纹理、附收纳带'));
