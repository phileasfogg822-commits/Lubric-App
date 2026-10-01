-- 023_price_memory_index.sql — make party-wise price memory cheap to read.
--
-- The billing screen now asks, for every product in the cart, "what did this
-- customer last pay for this, and for how many litres". That query filters
-- order_items by kind and ref_id, and the only index on the table was on
-- order_id - so it scanned every line ever sold, on every keystroke that
-- settled a cart, and got slower exactly as the catalogue grew.
--
-- The leading column is kind because it is the constant discriminator; ref_id is
-- the selective one; order_id is included so the index also serves the existing
-- per-bill line fetch the history panel already does.
--
-- Fully idempotent.
CREATE INDEX IF NOT EXISTS idx_oi_kind_ref ON order_items(kind, ref_id, order_id);

-- Same reason, from the other side of the join: a customer's bills are read on
-- every customer selection in POS, newest first.
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC);