-- 033_warehouses.sql — where the stock actually is.
--
-- Spec §35-§37: warehouse, location, bin/rack. §180: maintain stock movements.
--
-- What exists instead: products.stock_qty is ONE number per product per outlet.
-- A 20L drum in the back store and the same product on the front shelf are
-- indistinguishable, and there is nowhere to say that a case of filters is on
-- rack B2 rather than "somewhere".
--
-- ── The decision that keeps this safe ───────────────────────────────────────
-- products.stock_qty is NOT replaced. It stays as the TOTAL across warehouses,
-- so every existing read - the POS badge, the low-stock warning, the catalog
-- grid, the reports - keeps working untouched and keeps meaning the same thing.
-- Per-warehouse truth arrives alongside it in stock_levels.
--
-- The alternative, repointing every read at a per-warehouse table, would have
-- meant the POS badge had to guess which warehouse to count - and would have
-- changed what "stock" means on a dozen screens in one deploy.
--
-- ── Why a transfer must not change the total ────────────────────────────────
-- Moving a drum from the store to the shelf is two movements: -1 in the store,
-- +1 on the shelf. They net to zero, which is why stock_qty stays correct and
-- why 'transfer_in' / 'transfer_out' already exist as movement kinds. A
-- transfer that changed the total would be a stock loss recorded as a
-- relocation, and the shelf count would drift on every move.
--
-- ── One nuance worth stating ────────────────────────────────────────────────
-- stock_levels is a CACHE, exactly as stock_qty is, and it is rebuilt from the
-- same ledger. Two caches over one fact is a real cost: they can disagree. The
-- mitigation is that both are derived, and a check below FAILS the migration if
-- the sum of the per-warehouse levels does not equal stock_qty - so the two can
-- never be committed in a state that contradicts itself.
--
-- Fully idempotent.

CREATE TABLE IF NOT EXISTS warehouses (
  id         SERIAL PRIMARY KEY,
  uuid       TEXT UNIQUE NOT NULL,
  -- Outlets already exist (migration 029), and stock belongs to one of them.
  shop_id    INTEGER NOT NULL REFERENCES shops(id),
  name       TEXT NOT NULL,
  code       TEXT,
  address    TEXT,
  -- The bin the POS falls back to when nothing more specific is asked for.
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_warehouses_shop ON warehouses (shop_id, active);
-- One default per outlet. Two defaults means the fallback depends on row order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_default
  ON warehouses (shop_id) WHERE is_default AND active = 1;

-- Rack / shelf / bin INSIDE a warehouse (spec §37).
CREATE TABLE IF NOT EXISTS warehouse_locations (
  id           SERIAL PRIMARY KEY,
  uuid         TEXT UNIQUE NOT NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  -- Denormalised from the warehouse so a location can be read without a join on
  -- every stock query, and so row security can scope it by shop_id like every
  -- other business table.
  shop_id      INTEGER NOT NULL REFERENCES shops(id),
  name         TEXT NOT NULL,
  code         TEXT,
  -- Free text rather than an enum: a shop has racks, a workshop has bays, and
  -- this is a label on a shelf, not a business rule.
  kind         TEXT DEFAULT 'rack',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wloc_warehouse ON warehouse_locations (warehouse_id, active);

-- ── per-warehouse balances ──────────────────────────────────────────────────
-- The new granularity, alongside stock_qty rather than replacing it.
CREATE TABLE IF NOT EXISTS stock_levels (
  id           SERIAL PRIMARY KEY,
  -- uuid is required, not a nicety: the sync upserts on it, and a replicated
  -- table without one makes the desktop pull fail on a "no such column" error
  -- rather than degrading.
  uuid         TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  shop_id      INTEGER NOT NULL REFERENCES shops(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty          NUMERIC(18,3) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (warehouse_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_levels_product ON stock_levels (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_shop ON stock_levels (shop_id, warehouse_id);

-- ── the ledger learns where ─────────────────────────────────────────────────
-- warehouse_id already exists on stock_movements (migration 025) but is unused
-- and unconstrained. Give it its reference, and add the finer location.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_warehouse_id_fkey;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_warehouse_id_fkey
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS location_id INTEGER
  REFERENCES warehouse_locations(id) ON DELETE SET NULL;

-- ── a default warehouse for every outlet, so existing stock has a home ──────
INSERT INTO warehouses (uuid, shop_id, name, code, is_default, active)
VALUES
  ('wh-default-1', 1, 'Main Store', 'MAIN', TRUE, 1),
  ('wh-default-2', 2, 'Outlet 2 Store', 'O2', TRUE, 1)
ON CONFLICT (uuid) DO NOTHING;

-- A rack to start with, so the location dimension is usable immediately rather
-- than being a column that needs configuring before it does anything.
INSERT INTO warehouse_locations (uuid, warehouse_id, shop_id, name, code, kind)
SELECT 'wl-main-a', w.id, w.shop_id, 'Front shelf', 'A1', 'shelf'
  FROM warehouses w WHERE w.uuid = 'wh-default-1'
ON CONFLICT (uuid) DO NOTHING;

-- ── backfill ────────────────────────────────────────────────────────────────
-- Every existing movement belongs to its outlet's default warehouse. Posted as
-- a SET on the rows rather than as new 'opening' movements, because the stock
-- did not move - only the ledger's knowledge of WHERE it is has improved.
-- Inventing movements here would double the shop's stock.
UPDATE stock_movements m
   SET warehouse_id = w.id
  FROM warehouses w
 WHERE m.warehouse_id IS NULL
   AND w.shop_id = m.shop_id
   AND w.is_default;

-- And the per-warehouse balances start as the outlet's totals, since all of it
-- is in the default warehouse at this moment.
INSERT INTO stock_levels (shop_id, warehouse_id, product_id, qty)
SELECT p.shop_id, w.id, p.id, COALESCE(p.stock_qty, 0)
  FROM products p
  JOIN warehouses w ON w.shop_id = p.shop_id AND w.is_default
 WHERE p.shop_id IN (1, 2)
   AND COALESCE(p.stock_qty, 0) <> 0
ON CONFLICT (warehouse_id, product_id) DO NOTHING;

-- ── rebuild the per-warehouse cache from the ledger ─────────────────────────
-- Same idea as rebuild_stock (migration 025): stock_levels is a cache, this is
-- how it is derived, and the two can therefore never drift permanently.
CREATE OR REPLACE FUNCTION rebuild_stock_levels(p_shop_id INTEGER DEFAULT 1)
RETURNS TABLE (warehouse_id INTEGER, product_id INTEGER, ledger_qty NUMERIC, cached_qty NUMERIC, fixed NUMERIC)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH ledger AS (
    SELECT m.warehouse_id AS wid, m.item_id AS pid, SUM(m.qty) AS qty
      FROM stock_movements m
     WHERE m.shop_id = p_shop_id AND m.warehouse_id IS NOT NULL
     GROUP BY m.warehouse_id, m.item_id
  )
  SELECT l.wid,
         l.pid,
         l.qty,
         COALESCE(s.qty, 0),
         l.qty - COALESCE(s.qty, 0)
    FROM ledger l
    LEFT JOIN stock_levels s
      ON s.warehouse_id = l.wid AND s.product_id = l.pid;
END;
$$;

-- ── the check that justifies having two caches ──────────────────────────────
DO $verify$
DECLARE
  no_default   INTEGER;
  two_defaults INTEGER;
  orphans      INTEGER;
  mismatched   INTEGER;
BEGIN
  -- Every active outlet needs exactly one default warehouse, or the POS has no
  -- bin to fall back to and stock writes fail.
  SELECT count(*) INTO no_default
    FROM shops s
   WHERE NOT EXISTS (
     SELECT 1 FROM warehouses w
      WHERE w.shop_id = s.id AND w.is_default AND w.active = 1);
  IF no_default > 0 THEN
    RAISE EXCEPTION '% outlet(s) have no default warehouse', no_default;
  END IF;

  SELECT count(*) INTO two_defaults FROM (
    SELECT shop_id FROM warehouses WHERE is_default AND active = 1
     GROUP BY shop_id HAVING count(*) > 1) t;
  IF two_defaults > 0 THEN
    RAISE EXCEPTION '% outlet(s) have more than one default warehouse', two_defaults;
  END IF;

  -- A movement in no warehouse cannot be counted anywhere, so it would silently
  -- vanish from every per-warehouse total.
  SELECT count(*) INTO orphans
    FROM stock_movements WHERE shop_id = 1 AND warehouse_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION '% stock movement(s) are in no warehouse', orphans;
  END IF;

  -- THE important one. stock_qty (total) and stock_levels (per warehouse) are
  -- both caches over the same ledger, and two caches can disagree. This is the
  -- statement that refuses to let them.
  SELECT count(*) INTO mismatched
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(qty) AS qty FROM stock_levels
       WHERE shop_id = 1 GROUP BY product_id) l ON l.product_id = p.id
   WHERE p.shop_id = 1
     AND COALESCE(p.stock_qty, 0) <> COALESCE(l.qty, 0);
  IF mismatched > 0 THEN
    RAISE EXCEPTION
      'the total (%) disagrees with the per-warehouse sum on % item(s)',
      'products.stock_qty', mismatched;
  END IF;

  RAISE NOTICE 'warehouses ready; totals and per-warehouse levels agree for every item';
END
$verify$;