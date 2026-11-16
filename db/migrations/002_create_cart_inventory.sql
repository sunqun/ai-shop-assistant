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
  source ENUM('WEB', 'AI') NOT NULL DEFAULT 'WEB',
  cart_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_carts_expiry (expires_at)
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
  status ENUM('ACTIVE', 'RELEASED', 'EXPIRED') NOT NULL,
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
  event_type ENUM('RESERVED', 'RELEASED', 'EXPIRED') NOT NULL,
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
  promotion VARCHAR(32) NOT NULL,
  rule_version VARCHAR(64) NOT NULL,
  subtotal_minor BIGINT UNSIGNED NOT NULL,
  discount_minor BIGINT UNSIGNED NOT NULL,
  shipping_minor BIGINT UNSIGNED NOT NULL,
  total_minor BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cart_quotes_cart_version (cart_id, cart_version, created_at),
  CONSTRAINT fk_cart_quotes_cart FOREIGN KEY (cart_id) REFERENCES carts (cart_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO inventory_skus (sku_id, product_id, on_hand) VALUES
  ('desk-kit', 'desk-kit', 18),
  ('airbuds-pro', 'airbuds-pro', 42),
  ('travel-pack', 'travel-pack', 7),
  ('air-fryer', 'air-fryer', 26),
  ('desk-lamp', 'desk-lamp', 31),
  ('fitness-watch', 'fitness-watch', 12),
  ('coffee-maker', 'coffee-maker', 4),
  ('webcam', 'webcam', 16),
  ('suitcase', 'suitcase', 0),
  ('air-purifier', 'air-purifier', 23),
  ('tablet', 'tablet', 9),
  ('yoga-mat', 'yoga-mat', 35);

