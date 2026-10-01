-- 024_exact_money.sql — stop storing money in binary floating point.
--
-- The spec is explicit (§237): "Never use binary floating-point for money."
-- Every money and quantity column in this database was DOUBLE PRECISION, which
-- cannot represent 0.10 exactly - and this is a ledger, where a customer's
-- balance is the SUM of a few thousand rows. Each row's error is tiny; the sum
-- of thousands of them is not, and it compounds with every document type added
-- on top.
--
-- Two scales, because money and quantity are not the same thing:
--   money      NUMERIC(18,4) - four decimals so unit prices and rates
--                            (wholesale tiers, discounts) are exact; totals
--                            are still whole-rupee values to the shopkeeper.
--   quantity   NUMERIC(18,3) - litres and stock to the millilitre, because a
--                            3.5L fill and 0.1L top-ups must reconcile exactly.
--
-- The cast is lossless in the way that matters: float8 -> numeric converts to
-- the SHORTEST decimal that round-trips, so 0.1 stays 0.1. It also quietly
-- CLEANS data: a value that had drifted to 0.30000000000000004 now stores as
-- 0.3000.
--
-- `USING col::numeric` is explicit rather than relying on the implicit
-- double8->numeric assignment cast, so the conversion is visible in the deploy
-- log and cannot change meaning if an assignment cast is ever relaxed.
--
-- Fully idempotent: every ALTER re-applies cleanly to an already-converted
-- column.
--
-- IMPORTANT: this requires the NUMERIC type parser in server/db.js. Without it
-- node-postgres returns these columns as STRINGS, and every client-side total
-- in the browser ("0" + "4321.50") silently becomes string concatenation.

-- ── money ───────────────────────────────────────────────────────────────────
ALTER TABLE account_transactions ALTER COLUMN amount      TYPE NUMERIC(18,4) USING amount::numeric;
ALTER TABLE accounts             ALTER COLUMN balance     TYPE NUMERIC(18,4) USING balance::numeric;
ALTER TABLE commitment_items     ALTER COLUMN unit_price  TYPE NUMERIC(18,4) USING unit_price::numeric;
ALTER TABLE commitment_items     ALTER COLUMN line_total  TYPE NUMERIC(18,4) USING line_total::numeric;
ALTER TABLE commitments          ALTER COLUMN total       TYPE NUMERIC(18,4) USING total::numeric;
ALTER TABLE customers            ALTER COLUMN credit_balance TYPE NUMERIC(18,4) USING credit_balance::numeric;
ALTER TABLE expenses             ALTER COLUMN amount      TYPE NUMERIC(18,4) USING amount::numeric;
ALTER TABLE order_items          ALTER COLUMN unit_price  TYPE NUMERIC(18,4) USING unit_price::numeric;
ALTER TABLE order_items          ALTER COLUMN line_total  TYPE NUMERIC(18,4) USING line_total::numeric;
ALTER TABLE orders               ALTER COLUMN total       TYPE NUMERIC(18,4) USING total::numeric;
ALTER TABLE orders               ALTER COLUMN paid_amount TYPE NUMERIC(18,4) USING paid_amount::numeric;
ALTER TABLE party_ledger         ALTER COLUMN amount      TYPE NUMERIC(18,4) USING amount::numeric;
ALTER TABLE payable_allocations  ALTER COLUMN amount      TYPE NUMERIC(18,4) USING amount::numeric;
ALTER TABLE products             ALTER COLUMN cost_price  TYPE NUMERIC(18,4) USING cost_price::numeric;
ALTER TABLE products             ALTER COLUMN price_returning TYPE NUMERIC(18,4) USING price_returning::numeric;
ALTER TABLE products             ALTER COLUMN price_walking   TYPE NUMERIC(18,4) USING price_walking::numeric;
ALTER TABLE products             ALTER COLUMN price_wholesale TYPE NUMERIC(18,4) USING price_wholesale::numeric;
ALTER TABLE purchase_order_items ALTER COLUMN cost_price  TYPE NUMERIC(18,4) USING cost_price::numeric;
ALTER TABLE purchase_order_items ALTER COLUMN line_total  TYPE NUMERIC(18,4) USING line_total::numeric;
ALTER TABLE purchase_orders      ALTER COLUMN total       TYPE NUMERIC(18,4) USING total::numeric;
ALTER TABLE services             ALTER COLUMN price       TYPE NUMERIC(18,4) USING price::numeric;
ALTER TABLE vendor_payables      ALTER COLUMN amount      TYPE NUMERIC(18,4) USING amount::numeric;
ALTER TABLE vendors              ALTER COLUMN payable_balance TYPE NUMERIC(18,4) USING payable_balance::numeric;

-- ── quantity: litres and stock ──────────────────────────────────────────────
ALTER TABLE commitment_items     ALTER COLUMN qty         TYPE NUMERIC(18,3) USING qty::numeric;
ALTER TABLE container_splits     ALTER COLUMN sold_qty    TYPE NUMERIC(18,3) USING sold_qty::numeric;
ALTER TABLE containers           ALTER COLUMN original_volume  TYPE NUMERIC(18,3) USING original_volume::numeric;
ALTER TABLE containers           ALTER COLUMN remaining_volume TYPE NUMERIC(18,3) USING remaining_volume::numeric;
ALTER TABLE order_items          ALTER COLUMN qty         TYPE NUMERIC(18,3) USING qty::numeric;
ALTER TABLE order_items          ALTER COLUMN capacity    TYPE NUMERIC(18,3) USING capacity::numeric;
ALTER TABLE order_items          ALTER COLUMN leftover_litres TYPE NUMERIC(18,3) USING leftover_litres::numeric;
ALTER TABLE products             ALTER COLUMN stock_qty   TYPE NUMERIC(18,3) USING stock_qty::numeric;
ALTER TABLE products             ALTER COLUMN low_stock_threshold TYPE NUMERIC(18,3) USING low_stock_threshold::numeric;
ALTER TABLE products             ALTER COLUMN wholesale_min_qty TYPE NUMERIC(18,3) USING wholesale_min_qty::numeric;
ALTER TABLE purchase_order_items ALTER COLUMN qty         TYPE NUMERIC(18,3) USING qty::numeric;
ALTER TABLE shops                ALTER COLUMN used_oil_drum_capacity TYPE NUMERIC(18,3) USING used_oil_drum_capacity::numeric;
ALTER TABLE used_oil_drum        ALTER COLUMN current_litres TYPE NUMERIC(18,3) USING current_litres::numeric;
ALTER TABLE used_oil_drum        ALTER COLUMN capacity      TYPE NUMERIC(18,3) USING capacity::numeric;
ALTER TABLE used_oil_log         ALTER COLUMN litres        TYPE NUMERIC(18,3) USING litres::numeric;
ALTER TABLE vehicles             ALTER COLUMN oil_capacity  TYPE NUMERIC(18,3) USING oil_capacity::numeric;

-- Proof in the deploy log. The ledger and the cash account are the two figures
-- that must never move, so their sums are printed after the conversion rather
-- than left for someone to notice a week later.
DO $verify$
DECLARE
  pl_total NUMERIC;
  acc_total NUMERIC;
  order_total NUMERIC;
BEGIN
  SELECT ROUND(COALESCE(SUM(amount), 0), 4) INTO pl_total FROM party_ledger;
  SELECT ROUND(COALESCE(SUM(balance), 0), 4) INTO acc_total FROM accounts;
  SELECT ROUND(COALESCE(SUM(total), 0), 4) INTO order_total FROM orders;
  RAISE NOTICE 'party_ledger total after conversion: %', pl_total;
  RAISE NOTICE 'accounts total after conversion:       %', acc_total;
  RAISE NOTICE 'orders total after conversion:         %', order_total;
END
$verify$;
