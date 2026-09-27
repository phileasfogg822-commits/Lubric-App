-- Oil capacity of the car, plus where the unused oil left in the bottle goes.
--
-- A 4L bottle poured into a 3.5L engine leaves 0.5L. The customer is billed the
-- full bottle; the 0.5L either goes back on the shelf as a partial container
-- (default) or is handed back to the customer on request.
--
-- Idempotent: migrate.js replays every .sql file on each boot.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS capacity          DOUBLE PRECISION DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS leftover_litres   DOUBLE PRECISION DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS leftover_to       TEXT DEFAULT 'container';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS leftover_released BOOLEAN DEFAULT FALSE;

-- Remembered per vehicle so the next oil change prefills itself.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS oil_capacity DOUBLE PRECISION DEFAULT 0;

-- 'container' = back on the shelf, 'customer' = handed back to the buyer.
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_leftover_to_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_leftover_to_check
  CHECK (leftover_to IN ('container', 'customer'));

CREATE INDEX IF NOT EXISTS idx_containers_source_order ON containers(source_order_id);
