-- Catalog page support: extra product fields + used-oil log fixes.
-- Fully idempotent, because migrate.js replays every .sql file on each boot.

-- ─── Products: real supplier link + date received ──────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_id     INTEGER REFERENCES vendors(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS received_date TEXT;
CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id);

-- ─── Used oil log ──────────────────────────────────────────────────────────
-- The Used Oil page writes type='collected' / 'disposed' together with a notes
-- value, but the original column CHECK only allowed ('added','removed') and
-- there was no notes column — so every Collect/Dispose click failed.
ALTER TABLE used_oil_log ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE used_oil_log DROP CONSTRAINT IF EXISTS used_oil_log_type_check;
ALTER TABLE used_oil_log ADD CONSTRAINT used_oil_log_type_check
  CHECK (type IN ('added', 'removed', 'collected', 'disposed'));

-- ─── Demo suppliers ────────────────────────────────────────────────────────
-- Same demo spirit as 003_sample_data.sql: delete both files and run
-- `docker compose down -v` if you want a completely clean database.
INSERT INTO vendors (id, name, contact, phone) VALUES
  (1, 'Shell Distributors',      'Ali Khan',    '0300-1110001'),
  (2, 'Mobil Authorised Dealer', 'Bilal Ahmed', '0321-2220002'),
  (3, 'Castrol Wholesale',       'Usman Tariq', '0333-3330003')
ON CONFLICT (id) DO NOTHING;

UPDATE products SET vendor_id = 1 + (id % 3) WHERE vendor_id IS NULL AND id BETWEEN 1 AND 12;

SELECT setval(pg_get_serial_sequence('vendors', 'id'), COALESCE((SELECT MAX(id) FROM vendors), 1));