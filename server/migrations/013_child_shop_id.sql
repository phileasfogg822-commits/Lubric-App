-- 013_child_shop_id.sql — give the child tables a shop_id so sync can scope them.
--
-- BUG THIS FIXES: the pull endpoint ran
--     SELECT * FROM vehicles WHERE shop_id = $1 AND updated_at > $2
-- but vehicles (and order_items, account_transactions, vendor_payables) never
-- had a shop_id column. Postgres threw, the rejection was unhandled, Node 20
-- exited, Docker restarted the API, and the phone saw the connection drop as
-- "cannot reach the server". One missing column took the whole server down on
-- every single sync.
--
-- shop_id is backfilled from the parent row and kept correct by a trigger, so
-- new rows are scoped automatically.
-- Fully idempotent.

-- ── 1. add the column ───────────────────────────────────────────────────────
ALTER TABLE order_items           ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);
ALTER TABLE account_transactions  ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);
ALTER TABLE vehicles             ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);
ALTER TABLE vendor_payables      ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);

-- ── 2. backfill from the parent ─────────────────────────────────────────────
UPDATE order_items oi SET shop_id = o.shop_id
  FROM orders o WHERE o.id = oi.order_id AND oi.shop_id IS NULL;

UPDATE account_transactions at SET shop_id = a.shop_id
  FROM accounts a WHERE a.id = at.account_id AND at.shop_id IS NULL;

UPDATE vehicles v SET shop_id = c.shop_id
  FROM customers c WHERE c.id = v.customer_id AND v.shop_id IS NULL;

UPDATE vendor_payables vp SET shop_id = ve.shop_id
  FROM vendors ve WHERE ve.id = vp.vendor_id AND vp.shop_id IS NULL;

-- ── 3. keep it correct for future rows ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_child_shop_id() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shop_id IS NULL THEN
    CASE TG_TABLE_NAME
      WHEN 'order_items' THEN
        SELECT shop_id INTO NEW.shop_id FROM orders WHERE id = NEW.order_id;
      WHEN 'account_transactions' THEN
        SELECT shop_id INTO NEW.shop_id FROM accounts WHERE id = NEW.account_id;
      WHEN 'vehicles' THEN
        SELECT shop_id INTO NEW.shop_id FROM customers WHERE id = NEW.customer_id;
      WHEN 'vendor_payables' THEN
        SELECT shop_id INTO NEW.shop_id FROM vendors WHERE id = NEW.vendor_id;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_items_shop ON order_items;
CREATE TRIGGER trg_order_items_shop BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION fill_child_shop_id();

DROP TRIGGER IF EXISTS trg_account_transactions_shop ON account_transactions;
CREATE TRIGGER trg_account_transactions_shop BEFORE INSERT ON account_transactions
  FOR EACH ROW EXECUTE FUNCTION fill_child_shop_id();

DROP TRIGGER IF EXISTS trg_vehicles_shop ON vehicles;
CREATE TRIGGER trg_vehicles_shop BEFORE INSERT ON vehicles
  FOR EACH ROW EXECUTE FUNCTION fill_child_shop_id();

DROP TRIGGER IF EXISTS trg_vendor_payables_shop ON vendor_payables;
CREATE TRIGGER trg_vendor_payables_shop BEFORE INSERT ON vendor_payables
  FOR EACH ROW EXECUTE FUNCTION fill_child_shop_id();

-- ── 4. index them, the pull query filters on (shop_id, updated_at) ──────────
CREATE INDEX IF NOT EXISTS idx_order_items_shop          ON order_items(shop_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_account_transactions_shop ON account_transactions(shop_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_vehicles_shop             ON vehicles(shop_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_vendor_payables_shop      ON vendor_payables(shop_id, updated_at);
