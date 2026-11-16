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

INSERT IGNORE INTO product_search_aliases (alias, canonical_term) VALUES
  ('充电宝', '行動電源'),
  ('充電寶', '行動電源'),
  ('移动电源', '行動電源'),
  ('移動電源', '行動電源'),
  ('行动电源', '行動電源'),
  ('隨身電源', '行動電源'),
  ('随身电源', '行動電源'),
  ('電源銀行', '行動電源');
