-- M6/M7 only persist an order record. Payment and fulfillment lifecycles are out of scope.
ALTER TABLE order_groups DROP COLUMN settlement_status;
ALTER TABLE orders DROP COLUMN fulfillment_status;
ALTER TABLE orders DROP COLUMN settlement_status;
