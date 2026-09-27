-- 008_reporting.sql — reporting foundation: paid/remaining per bill + indexes.
-- Idempotent: migrate.js replays every file on each boot.

-- How much of a bill was actually collected. Cash sales post the full total;
-- lowering it in Sales History records credit (udhaar) for the rest.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount DOUBLE PRECISION DEFAULT 0;

-- Historic orders predate the column: everything was collected at the till.
UPDATE orders SET paid_amount = total
WHERE (paid_amount IS NULL OR paid_amount = 0) AND status = 'completed';

CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_oi_order        ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_tx_created      ON account_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_exp_created     ON expenses(created_at);
CREATE INDEX IF NOT EXISTS idx_po_vendor       ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vp_vendor       ON vendor_payables(vendor_id);
