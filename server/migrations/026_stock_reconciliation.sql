-- 026_stock_reconciliation.sql — bring the stock ledger in line with the shelf.
--
-- Background. Migration 025 opened the ledger from whatever products.stock_qty
-- held at that moment. Afterwards the cache moved and the ledger did not:
--
--   * 325 units on hand across 12 products at the time of the backfill
--   * 10 products now read 20 on screen
--
-- The ledger named the cause, which is the entire point of having it: the
-- catalog edit form wrote products.stock_qty straight to the column, so every
-- physical count was a silent overwrite that left no movement behind. That form
-- now posts the difference as a count_correction (ProductPane.tsx), so this
-- cannot happen again - but the ten counts it already lost are still missing.
--
-- The shopkeeper has confirmed 20 is the real figure on the shelf, so the LEDGER
-- is what moves here, not the cache. The alternative - rebuild_stock(), which
-- would have pushed the cache back up to 40/25/30/18/35/8/15/40/24/50 - would
-- have overwritten live stock with the seed data from migration 003 and lost
-- the count. The ledger is the record, so the record was wrong and is corrected.
--
-- Nothing is deleted and nothing is overwritten: each correction is an ordinary
-- append-only movement, so the history reads as "counted 20, books said 40" and
-- the reasoning survives. If a count is later found to be wrong it is corrected
-- the same way, with another row.
--
-- Idempotent: once no item disagrees, this inserts nothing and re-running it is
-- a no-op. Safe to run against an environment that never had the drift.

DO $reconcile$
DECLARE
  fixed_count INTEGER := 0;
BEGIN
  INSERT INTO stock_movements
    (uuid, shop_id, item_id, kind, qty, qty_after, ref_table, ref_id, note, occurred_at)
  SELECT gen_random_uuid()::text,
         p.shop_id,
         p.id,
         'count_correction',
         COALESCE(p.stock_qty, 0) - COALESCE(l.qty, 0),
         p.stock_qty,
         'products',
         p.id,
         'Stock counted at ' || COALESCE(p.stock_qty, 0) || ', books said ' || COALESCE(l.qty, 0),
         NOW()
    FROM products p
    LEFT JOIN (SELECT item_id, SUM(qty) AS qty
                 FROM stock_movements
                WHERE shop_id = 1
                GROUP BY item_id) l
      ON l.item_id = p.id
   WHERE p.shop_id = 1
     AND COALESCE(p.stock_qty, 0) <> COALESCE(l.qty, 0);

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'posted % count_correction movement(s) to match the shelf', fixed_count;
END
$reconcile$;

-- The whole reason the ledger exists: after this, the two can no longer disagree
-- silently, and if they ever do again, this is the statement that says so.
DO $verify$
DECLARE
  mismatches INTEGER;
  ledger_total NUMERIC;
  cached_total NUMERIC;
BEGIN
  SELECT COUNT(*) INTO mismatches
    FROM rebuild_stock(1) r
   WHERE r.fixed <> 0;

  IF mismatches > 0 THEN
    RAISE EXCEPTION 'stock ledger still disagrees with stock_qty on % item(s)', mismatches;
  END IF;

  SELECT ROUND(COALESCE(SUM(qty), 0), 3) INTO ledger_total FROM stock_movements WHERE shop_id = 1;
  SELECT ROUND(COALESCE(SUM(stock_qty), 0), 3) INTO cached_total
    FROM products WHERE shop_id = 1;

  RAISE NOTICE 'ledger and stock_qty now agree on every item: % units', ledger_total;
  IF ledger_total <> cached_total THEN
    RAISE EXCEPTION 'ledger % <> cache %', ledger_total, cached_total;
  END IF;
END
$verify$;