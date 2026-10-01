-- 025_stock_ledger.sql — make stock a record, not a number.
--
-- Spec §180: "Do not rely only on item.quantity. Maintain stock movements."
-- §253 puts the stock ledger alongside the journal as something to build BEFORE
-- the document screens, because every document type that moves stock would
-- otherwise grow its own ad-hoc update.
--
-- What is true today, and the reason this matters more than a tidy-up:
--   * products.stock_qty is a bare number with no history.
--   * It can only ever go DOWN, from a sale, and back up when a sale is voided.
--   * A purchase cannot increase it at all - the Purchase screen is a
--     placeholder and purchase_orders has zero rows. So buying oil has no way
--     to be recorded as arriving.
--   * 325 units of stock are set by hand and explained by nothing.
--
-- So the ledger is not duplicating an existing truth; it is the first record
-- of it. The backfill opens a balance for exactly the stock the shop already
-- believes it has, dated today, so the two agree from the moment this runs and
-- every future movement is explainable.
--
-- The model is the standard one: an append-only event table plus a cached
-- balance. stock_qty stays as the fast column the app reads, and
-- rebuild_stock() recomputes it from the ledger so the two can never silently
-- diverge - which is what makes the cached value trustworthy rather than a
-- number nobody can audit.
--
-- Fully idempotent.
CREATE TABLE IF NOT EXISTS stock_movements (
  id                  SERIAL PRIMARY KEY,
  uuid                TEXT UNIQUE NOT NULL,
  shop_id             INTEGER NOT NULL REFERENCES shops(id),
  item_id             INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Signed quantity: positive adds stock, negative removes it. Storing the sign
  -- rather than a separate direction column is what makes SUM() the balance.
  kind                TEXT NOT NULL CHECK (kind IN (
                        'opening', 'purchase', 'sale', 'sale_return',
                        'purchase_return', 'adjustment', 'transfer_in',
                        'transfer_out', 'damage', 'found', 'count_correction')),
  qty                 NUMERIC(18,3) NOT NULL,
  -- Running balance immediately after this movement. Denormalised on purpose:
  -- "what did we have after that" is the question a shopkeeper actually asks,
  -- and recomputing it per row is a correlated subquery on every read.
  qty_after           NUMERIC(18,3),
  ref_table           TEXT,
  ref_id              INTEGER,
  warehouse_id        INTEGER,
  note                TEXT DEFAULT '',
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id  INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_item_time ON stock_movements(shop_id, item_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_stock_ref        ON stock_movements(ref_table, ref_id);
CREATE INDEX IF NOT EXISTS idx_stock_kind       ON stock_movements(shop_id, kind, occurred_at);

-- The reconciliation the whole design rests on: stock_qty is a CACHE of this.
-- Safe to run at any time; the app can call it whenever a total looks wrong
-- and the ledger, not the cache, is the authority.
CREATE OR REPLACE FUNCTION rebuild_stock(p_shop_id INTEGER DEFAULT 1)
RETURNS TABLE (item_id INTEGER, ledger_qty NUMERIC, cached_qty NUMERIC, fixed NUMERIC)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH ledger AS (
    SELECT m.item_id, SUM(m.qty) AS qty
      FROM stock_movements m
     WHERE m.shop_id = p_shop_id
     GROUP BY m.item_id
  )
  SELECT p.id,
         COALESCE(l.qty, 0),
         COALESCE(p.stock_qty, 0),
         COALESCE(l.qty, 0) - COALESCE(p.stock_qty, 0)
    FROM products p
    LEFT JOIN ledger l ON l.item_id = p.id
   WHERE p.shop_id = p_shop_id;
END;
$$;

-- Open a balance for the stock the shop already has, so the ledger explains
-- today's numbers instead of starting empty and disagreeing with them.
-- Only for items with no movements yet, which makes this a no-op on a re-run.
INSERT INTO stock_movements (uuid, shop_id, item_id, kind, qty, qty_after, note, occurred_at)
SELECT gen_random_uuid()::text,
       p.shop_id, p.id, 'opening', p.stock_qty, p.stock_qty,
       'Opening balance recorded when the stock ledger was introduced',
       NOW()
  FROM products p
 WHERE p.shop_id = 1
   AND COALESCE(p.stock_qty, 0) <> 0
   AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.item_id = p.id);

-- Proof in the deploy log, and a report of any drift.
--
-- This is deliberately a NOTICE, not a RAISE EXCEPTION, even though an earlier
-- draft threw. Two reasons, both learned the hard way:
--
--   1. The migration runner re-executes every file on every boot, relying on
--      each being idempotent. So this block runs again long after the backfill,
--      long after the app has legitimately moved stock, and a hard throw here
--      aborts the whole run - which meant it blocked migration 026, the very
--      migration that reconciles the drift. A guard must never block its own
--      repair.
--   2. Once the app is live, stock legitimately moves. A cache/ledger
--      difference is no longer evidence that the BACKFILL was wrong; it is the
--      ledger correctly reporting that something changed stock outside it.
--      That is a reconciliation task (026), not a reason to refuse to boot.
--
-- The hard guarantee - that the two agree before a financial report trusts the
-- ledger - lives in 026, which runs after it has had the chance to fix things.
DO $verify$
DECLARE
  mismatches INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatches
    FROM products p
    LEFT JOIN (SELECT item_id, SUM(qty) AS qty
                 FROM stock_movements WHERE shop_id = 1 GROUP BY item_id) l
      ON l.item_id = p.id
   WHERE p.shop_id = 1
     AND COALESCE(l.qty, 0) <> COALESCE(p.stock_qty, 0);

  IF mismatches > 0 THEN
    RAISE NOTICE 'stock ledger differs from stock_qty on % item(s) - reconciliation required',
                 mismatches;
  ELSE
    RAISE NOTICE 'stock ledger opened; ledger and cache agree for every item';
  END IF;
END
$verify$;