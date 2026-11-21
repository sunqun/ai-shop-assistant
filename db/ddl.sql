-- ============================================================
-- DDL（最终表结构）
-- 由 db/migrations/ 下 14 个迁移合并而来，已按外键依赖重排。
-- 执行顺序：先执行本文件，再执行 dml.sql。
-- 所有 ALTER（加列/删列/改枚举）已内联到最终建表语句中。
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  userid CHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  category_id VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  tone VARCHAR(32) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  product_id VARCHAR(100) NOT NULL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  brand VARCHAR(100) NOT NULL,
  category_id VARCHAR(32) NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'TWD',
  margin_rate DECIMAL(5, 4) NOT NULL DEFAULT 0,
  recommendation_score DECIMAL(8, 2) NOT NULL DEFAULT 0,
  specs JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_recommendation (recommendation_score),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (category_id)
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

CREATE TABLE IF NOT EXISTS product_search_aliases (
  alias_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alias VARCHAR(191) NOT NULL,
  canonical_term VARCHAR(191) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_search_alias (alias, canonical_term),
  INDEX idx_product_search_alias_active (alias, is_active),
  INDEX idx_product_search_canonical_active (canonical_term, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_skus (
  sku_id VARCHAR(100) NOT NULL PRIMARY KEY,
  product_id VARCHAR(100) NOT NULL UNIQUE,
  on_hand INT UNSIGNED NOT NULL,
  reserved INT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_inventory_reserved CHECK (reserved <= on_hand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carts (
  cart_id CHAR(64) NOT NULL PRIMARY KEY,
  userid CHAR(36) NULL,
  source ENUM('WEB', 'AI') NOT NULL DEFAULT 'WEB',
  cart_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_carts_expiry (expires_at),
  INDEX idx_carts_user_source (userid, source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id CHAR(64) NOT NULL,
  sku_id VARCHAR(100) NOT NULL,
  requested_quantity INT UNSIGNED NOT NULL,
  allocated_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  unavailable_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (cart_id, sku_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts (cart_id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_items_sku FOREIGN KEY (sku_id) REFERENCES inventory_skus (sku_id),
  CONSTRAINT chk_cart_item_split CHECK (requested_quantity = allocated_quantity + unavailable_quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  cart_id CHAR(64) NOT NULL,
  sku_id VARCHAR(100) NOT NULL,
  reserved_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'RELEASED', 'EXPIRED', 'CONSUMED') NOT NULL,
  expires_at DATETIME(3) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cart_id, sku_id),
  INDEX idx_reservations_expiry (status, expires_at),
  CONSTRAINT fk_reservations_cart FOREIGN KEY (cart_id) REFERENCES carts (cart_id) ON DELETE CASCADE,
  CONSTRAINT fk_reservations_sku FOREIGN KEY (sku_id) REFERENCES inventory_skus (sku_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_reservation_events (
  event_id CHAR(36) NOT NULL PRIMARY KEY,
  cart_id CHAR(64) NOT NULL,
  sku_id VARCHAR(100) NOT NULL,
  event_type ENUM('RESERVED', 'RELEASED', 'EXPIRED', 'CONSUMED') NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  request_key VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reservation_events_cart (cart_id, created_at),
  CONSTRAINT fk_reservation_events_cart FOREIGN KEY (cart_id) REFERENCES carts (cart_id) ON DELETE CASCADE,
  CONSTRAINT fk_reservation_events_sku FOREIGN KEY (sku_id) REFERENCES inventory_skus (sku_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cart_mutations (
  cart_id CHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  response_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cart_id, idempotency_key),
  CONSTRAINT fk_cart_mutations_cart FOREIGN KEY (cart_id) REFERENCES carts (cart_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cart_quotes (
  quote_id CHAR(36) NOT NULL PRIMARY KEY,
  cart_id CHAR(64) NOT NULL,
  cart_version BIGINT UNSIGNED NOT NULL,
  selected_sku_ids JSON NULL,
  shopping_task_id CHAR(36) NULL,
  promotion VARCHAR(32) NOT NULL,
  rule_version VARCHAR(64) NOT NULL,
  subtotal_minor BIGINT UNSIGNED NOT NULL,
  discount_minor BIGINT UNSIGNED NOT NULL,
  shipping_minor BIGINT UNSIGNED NOT NULL,
  total_minor BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cart_quotes_cart_version (cart_id, cart_version, created_at),
  CONSTRAINT fk_cart_quotes_cart FOREIGN KEY (cart_id) REFERENCES carts (cart_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_groups (
  order_group_id CHAR(36) NOT NULL PRIMARY KEY,
  userid CHAR(36) NOT NULL,
  cart_id CHAR(64) NOT NULL,
  cart_version BIGINT UNSIGNED NOT NULL,
  source ENUM('WEB', 'AI') NOT NULL,
  quote_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  response_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_group_idempotency (userid, idempotency_key),
  INDEX idx_order_groups_user (userid, created_at),
  CONSTRAINT fk_order_groups_user FOREIGN KEY (userid) REFERENCES users (userid),
  CONSTRAINT fk_order_groups_cart FOREIGN KEY (cart_id) REFERENCES carts (cart_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  order_id CHAR(36) NOT NULL PRIMARY KEY,
  order_group_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_group FOREIGN KEY (order_group_id) REFERENCES order_groups (order_group_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  order_id CHAR(36) NOT NULL,
  sku_id VARCHAR(100) NOT NULL,
  product_name_snapshot VARCHAR(191) NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_minor BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (order_id, sku_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_audit_events (
  event_id CHAR(36) NOT NULL PRIMARY KEY,
  order_group_id CHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  provenance VARCHAR(32) NOT NULL,
  details_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_audit_group FOREIGN KEY (order_group_id) REFERENCES order_groups (order_group_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_links (
  link_id CHAR(36) NOT NULL PRIMARY KEY,
  token_value CHAR(43) NOT NULL UNIQUE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  userid CHAR(36) NOT NULL,
  cart_token CHAR(43) NOT NULL UNIQUE,
  product_id VARCHAR(100) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_payment_links_user (userid, deleted_at, created_at),
  CONSTRAINT fk_payment_links_user FOREIGN KEY (userid) REFERENCES users (userid),
  CONSTRAINT fk_payment_links_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT chk_payment_links_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
