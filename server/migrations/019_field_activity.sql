-- 019_field_activity.sql — make field data visible and complete.
--
-- Three problems with what a phone sends, all of them silent:
--
-- 1. The collector types WHO they collected from, but neither cash_movements
--    nor reservations had a customer_name column. /api/v1/push filters the
--    incoming row down to real columns, so customer_name was discarded on
--    every upload - the field user's most important detail, thrown away with
--    no error anywhere.
--
-- 2. Nothing recorded which phone sent a collection. /api/v1/push knows: the
--    request is authenticated by the device, so the server stamps it. That
--    makes collections attributable to a phone in the shop's own view.
--    ON DELETE SET NULL so removing a phone never blocks on its history.
--
-- 3. A date range query over occurred_at had no index; the shop's field view
--    sorts and filters by exactly that.
--
-- Fully idempotent.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS taken_by_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS customer_name TEXT;

CREATE INDEX IF NOT EXISTS idx_cashmov_occurred ON cash_movements(shop_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashmov_device ON cash_movements(taken_by_device_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_reserv_created ON reservations(shop_id, created_at DESC);