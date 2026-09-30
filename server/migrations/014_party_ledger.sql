-- 014_party_ledger.sql - the "khata": a real, queryable ledger per person.
--
-- WHY THIS EXISTS: customers.credit_balance and vendors.payable_balance are
-- denormalised running totals with no history behind them, and
-- account_transactions has no customer/vendor link at all, so it was
-- impossible to answer what a field user actually asks:
--   * "show me everything with Zafar Iqbal between March and June"
--   * "is he buying more or less than last month?"
--   * "print me his statement and WhatsApp it to him"
--
-- The fix is one append-only table where every movement affecting a party's
-- balance is a row. Balances, statements, trends and comparisons are all
-- derived from it rather than stored.
--
-- DIRECTION SEMANTICS (identical for both party types):
--   customer - a debit INCREASES what they owe us
--   vendor   - a debit INCREASES what we owe them
--
-- commitments + commitment_items are what the field user books on the road:
-- a party plus real catalog items, with no stock movement until the shop
-- converts them into a real order.
--
-- Fully idempotent.

-- -- Commitments (field bookings) ---------------------------------------------
CREATE TABLE IF NOT EXISTS commitments (
  id                  SERIAL PRIMARY KEY,
  uuid                TEXT UNIQUE NOT NULL,
  shop_id             INTEGER NOT NULL REFERENCES shops(id),
  party_type          TEXT NOT NULL CHECK (party_type IN ('customer','vendor')),
  party_id            INTEGER,
  status              TEXT NOT NULL DEFAULT 'booked'
                        CHECK (status IN ('booked','converted','cancelled')),
  total               DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes               TEXT DEFAULT '',
  taken_by_user_id    INTEGER,
  converted_order_id  INTEGER REFERENCES orders(id),
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origin              TEXT NOT NULL DEFAULT 'shop',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commitment_items (
  id            SERIAL PRIMARY KEY,
  uuid          TEXT UNIQUE NOT NULL,
  commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'product'
                  CHECK (kind IN ('product','service','partial_container','used_oil','other')),
  ref_id        INTEGER,
  product_name  TEXT DEFAULT '',
  qty           DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit_price    DOUBLE PRECISION NOT NULL DEFAULT 0,
  line_total    DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commitments_party   ON commitments(shop_id, party_type, party_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_commitments_status  ON commitments(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_commitments_updated ON commitments(shop_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_commitment_items    ON commitment_items(commitment_id);
-- -- The ledger --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_ledger (
  id                  SERIAL PRIMARY KEY,
  uuid                TEXT UNIQUE NOT NULL,
  shop_id             INTEGER NOT NULL REFERENCES shops(id),
  party_type          TEXT NOT NULL CHECK (party_type IN ('customer','vendor')),
  party_id            INTEGER NOT NULL,
  kind                TEXT NOT NULL
                        CHECK (kind IN ('opening','bill','payment','return','adjustment')),
  direction           TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount              DOUBLE PRECISION NOT NULL DEFAULT 0,
  order_id            INTEGER REFERENCES orders(id),
  vendor_payable_id   INTEGER REFERENCES vendor_payables(id),
  cash_movement_id    INTEGER REFERENCES cash_movements(id),
  commitment_id       INTEGER REFERENCES commitments(id),
  note                TEXT DEFAULT '',
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origin              TEXT NOT NULL DEFAULT 'shop',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The statement query filters on (party_type, party_id) and orders by
-- occurred_at, so that is the index that matters.
CREATE INDEX IF NOT EXISTS idx_ledger_party   ON party_ledger(shop_id, party_type, party_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ledger_month   ON party_ledger(shop_id, party_type, party_id, (date_trunc('month', occurred_at AT TIME ZONE 'UTC')));
CREATE INDEX IF NOT EXISTS idx_ledger_updated ON party_ledger(shop_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_uuid ON party_ledger(uuid);
-- One bill row per order, one payment row per order: keeps the backfill and
-- any future re-run from duplicating history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_order_kind
  ON party_ledger(order_id, kind) WHERE order_id IS NOT NULL;
-- -- Backfill: existing sales become ledger rows ------------------------------
-- A completed order is a bill (debit) for the full total, plus a payment
-- (credit) for whatever was actually collected at the till. The unpaid
-- remainder is the udhaar, which is exactly the balance the customer shows.
--
-- Guarded so re-running the migration can never duplicate history.
INSERT INTO party_ledger
  (uuid, shop_id, party_type, party_id, kind, direction, amount, order_id, note, occurred_at, origin)
SELECT gen_random_uuid()::text, o.shop_id, 'customer', o.customer_id, 'bill', 'debit',
       o.total, o.id, 'Bill #' || o.id, o.created_at, 'backfill'
  FROM orders o
 WHERE o.customer_id IS NOT NULL
   AND o.status = 'completed'
   AND COALESCE(o.total, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM party_ledger l WHERE l.order_id = o.id AND l.kind = 'bill');

INSERT INTO party_ledger
  (uuid, shop_id, party_type, party_id, kind, direction, amount, order_id, note, occurred_at, origin)
SELECT gen_random_uuid()::text, o.shop_id, 'customer', o.customer_id, 'payment', 'credit',
       o.paid_amount, o.id, 'Collected at till - bill #' || o.id, o.created_at, 'backfill'
  FROM orders o
 WHERE o.customer_id IS NOT NULL
   AND o.status = 'completed'
   AND COALESCE(o.paid_amount, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM party_ledger l WHERE l.order_id = o.id AND l.kind = 'payment');

-- Unpaid vendor invoices are what WE owe them: a debit on the vendor ledger.
INSERT INTO party_ledger
  (uuid, shop_id, party_type, party_id, kind, direction, amount, vendor_payable_id, note, occurred_at, origin)
SELECT gen_random_uuid()::text, v.shop_id, 'vendor', vp.vendor_id, 'bill', 'debit',
       vp.amount, vp.id, 'Purchase - due ' || COALESCE(vp.due_date::text, ''),
       COALESCE(vp.created_at, NOW()), 'backfill'
  FROM vendor_payables vp
  JOIN vendors v ON v.id = vp.vendor_id
 WHERE COALESCE(vp.amount, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM party_ledger l WHERE l.vendor_payable_id = vp.id);

-- Link a converted order back to the commitment it came from, so the shop can
-- see which road booking became which bill.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS converted_from_commitment_id INTEGER REFERENCES commitments(id);