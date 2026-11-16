ALTER TABLE cart_quotes ADD COLUMN consumed_at DATETIME(3) NULL;

CREATE TABLE IF NOT EXISTS order_groups (
  order_group_id CHAR(36) NOT NULL PRIMARY KEY,
  userid CHAR(36) NOT NULL,
  cart_id CHAR(64) NOT NULL,
  cart_version BIGINT UNSIGNED NOT NULL,
  source ENUM('WEB', 'AI') NOT NULL,
  quote_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  response_json JSON NULL,
  settlement_status ENUM('NOT_DUE', 'DUE', 'CHARGING', 'PAID', 'FAILED') NOT NULL DEFAULT 'NOT_DUE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_group_idempotency (userid, idempotency_key),
  INDEX idx_order_groups_user (userid, created_at),
  CONSTRAINT fk_order_groups_user FOREIGN KEY (userid) REFERENCES users (userid),
  CONSTRAINT fk_order_groups_cart FOREIGN KEY (cart_id) REFERENCES carts (cart_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  order_id CHAR(36) NOT NULL PRIMARY KEY,
  order_group_id CHAR(36) NOT NULL,
  fulfillment_status ENUM('PLACED', 'FULFILLING', 'SHIPPED', 'RECEIVED', 'COMPLETED') NOT NULL DEFAULT 'PLACED',
  settlement_status ENUM('NOT_DUE', 'DUE', 'CHARGING', 'PAID', 'FAILED') NOT NULL DEFAULT 'NOT_DUE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_group FOREIGN KEY (order_group_id) REFERENCES order_groups (order_group_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  order_id CHAR(36) NOT NULL,
  sku_id VARCHAR(100) NOT NULL,
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
