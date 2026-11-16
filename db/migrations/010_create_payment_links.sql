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
