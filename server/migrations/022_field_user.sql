-- 022_field_user.sql — who is actually in the field.
--
-- A device token identifies the PHONE, not the person holding it. That is not
-- enough for a shop that needs to know which collector took a payment, so the
-- phone now carries a name the user types once and stamps onto every record it
-- creates. Deliberately self-declared rather than a login: the field app has no
-- accounts by design (a collector opens the app and works), and requiring one
-- would only be paperwork that stops the next person using the phone.
--
-- Kept beside taken_by_device_id rather than replacing it - the shop wants both
-- "which phone" and "who was on it", and they are not the same question when a
-- phone is shared or swapped.
--
-- Fully idempotent.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS taken_by_name TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS taken_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_cashmov_taker ON cash_movements(taken_by_name, occurred_at DESC);