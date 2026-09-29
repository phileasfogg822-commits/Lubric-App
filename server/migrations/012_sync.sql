-- 012_sync.sql — Sync infrastructure for multi-device replication (desktop ↔ VPS ↔ APK).
-- Fully idempotent: re-running is harmless.

-- ── Sync metadata on the tables that replicate ───────────────────────────────
-- uuid: client-generated, globally unique — the sync key.
-- updated_at: LWW timestamp (server clock wins on conflict resolution).
-- deleted_at: soft delete so deletions replicate.

ALTER TABLE products   ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE products   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE products   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE services   ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE services   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE services   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE vehicles   ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE vehicles   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE vehicles   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE vendors    ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE vendors    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE vendors    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE expenses   ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE expenses   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE expenses   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE accounts   ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE accounts   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE account_transactions ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE account_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE vendor_payables ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE vendor_payables ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE reminders  ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE reminders  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_products_updated  ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_customers_updated ON customers(updated_at);
CREATE INDEX IF NOT EXISTS idx_orders_updated    ON orders(updated_at);

-- Backfill uuids for pre-existing rows (the column default only covers new rows).
UPDATE products            SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE services            SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE customers           SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE vehicles            SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE vendors             SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE orders              SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE order_items         SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE expenses            SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE accounts            SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE account_transactions SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE purchase_orders     SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE vendor_payables     SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE reminders           SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
UPDATE inspections         SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_uuid  ON products(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_uuid  ON services(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_uuid ON customers(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_uuid  ON vehicles(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_uuid   ON vendors(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_uuid    ON orders(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_uuid ON order_items(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_uuid  ON expenses(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_uuid  ON accounts(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_tx_uuid ON account_transactions(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_uuid ON purchase_orders(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_payables_uuid ON vendor_payables(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_uuid ON reminders(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspections_uuid ON inspections(uuid);

-- ── Devices (paired desktop / mobile clients) ────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id            SERIAL PRIMARY KEY,
  shop_id       INTEGER NOT NULL REFERENCES shops(id),
  kind          TEXT NOT NULL DEFAULT 'desktop' CHECK (kind IN ('desktop','mobile')),
  name          TEXT DEFAULT '',
  pairing_code  TEXT UNIQUE,                -- one-time code; NULL once paired
  token_hash    TEXT,                       -- bcrypt hash of the device token
  last_sync_at  TIMESTAMPTZ,
  revoked       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
UPDATE devices SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_uuid ON devices(uuid);

-- ── Cash movements (the APK's core table: collections, handovers) ───────────
CREATE TABLE IF NOT EXISTS cash_movements (
  id            SERIAL PRIMARY KEY,
  uuid          TEXT UNIQUE NOT NULL,
  shop_id       INTEGER NOT NULL REFERENCES shops(id),
  kind          TEXT NOT NULL CHECK (kind IN ('collection','handover','expense','adjustment')),
  amount        REAL NOT NULL DEFAULT 0,
  customer_id   INTEGER REFERENCES customers(id),
  vendor_id     INTEGER REFERENCES vendors(id),
  order_id      INTEGER REFERENCES orders(id),
  account_id    INTEGER REFERENCES accounts(id),
  taken_by_user_id INTEGER,
  note          TEXT DEFAULT '',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origin        TEXT NOT NULL DEFAULT 'shop',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_updated ON cash_movements(updated_at);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shop ON cash_movements(shop_id, occurred_at);

-- ── Reservations (goods set aside / booked for a customer) ───────────────────
CREATE TABLE IF NOT EXISTS reservations (
  id            SERIAL PRIMARY KEY,
  uuid          TEXT UNIQUE NOT NULL,
  shop_id       INTEGER NOT NULL REFERENCES shops(id),
  customer_id   INTEGER REFERENCES customers(id),
  items_json    TEXT NOT NULL DEFAULT '[]',
  amount        REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fulfilled','cancelled')),
  fulfilled_order_id INTEGER REFERENCES orders(id),
  created_by_user_id INTEGER,
  note          TEXT DEFAULT '',
  origin        TEXT NOT NULL DEFAULT 'shop',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reservations_updated ON reservations(updated_at);

-- ── Auto-increment repair (idempotent) ───────────────────────────────────────
-- Databases created BEFORE the SERIAL fix have devices / cash_movements /
-- reservations with a plain INTEGER PRIMARY KEY and no sequence attached, so any
-- INSERT that omits `id` dies with:
--     null value in column "id" of relation "devices" violates not-null constraint
-- Attach a sequence to each of them. Safe to re-run.
DO $fix$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['devices','cash_movements','reservations'] LOOP
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I_id_seq', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT nextval(%L)', t, t || '_id_seq');
    -- point the sequence just past the highest existing id (nextval then returns max+1)
    EXECUTE format(
      'SELECT setval(%L, GREATEST(COALESCE((SELECT MAX(id) FROM %I), 0) + 1, 1), false)',
      t || '_id_seq', t
    );
  END LOOP;
END
$fix$;