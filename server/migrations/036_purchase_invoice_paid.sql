-- 036_purchase_invoice_paid.sql — the vendor invoice records what was paid.
--
-- The purchase_orders row a vendor invoice saves carries `paid` (money
-- handed over with the shipment) and `notes` next to `total`, exactly
-- like orders carries paid_amount — but the server table never had
-- either column: the Purchase screen was a placeholder, so nothing ever
-- wrote them. The local table has had both since the Windows app's
-- first schema. Without these, the VPS invoice save dies with "column
-- paid does not exist" on the first invoice.
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS re-applies cleanly, and no
-- UPDATE/INSERT runs here at all, so there is nothing multi-row data
-- can trip on.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid NUMERIC(18,4) DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
