ALTER TABLE carts ADD COLUMN userid CHAR(36) NULL;
ALTER TABLE carts ADD INDEX idx_carts_user_source (userid, source);

UPDATE carts c
INNER JOIN order_groups og ON og.cart_id = c.cart_id
SET c.userid = og.userid
WHERE c.userid IS NULL;
