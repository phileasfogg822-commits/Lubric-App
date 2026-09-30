-- 017_payable_allocations.sql — split a payment across the invoices it settles.
--
-- WHY: a payment is often larger than the oldest open invoice, so it settles
-- more than one. party_ledger.vendor_payable_id can only point at ONE of them,
-- so there was no way to record that a 5,000 payment cleared a 3,000 invoice
-- and part of a 4,000 one. Deriving it by summing the ledger per payable gave
-- nonsense: a payable's own "bill" row is linked to it and counted as a
-- negative settlement, and a payment covering two invoices was credited
-- entirely to the first. The e2e test caught exactly that.
--
-- One row per (payment, invoice) pair, written in the same transaction as the
-- payment. `payment_uuid` rather than payment_ledger_id because the uuid is
-- known BEFORE the insert, so allocations can go in the same batch as the
-- payment row instead of needing its id back first.
--
-- This doubles as the audit trail for FIFO settlement: it is what proves the
-- shop cleared invoice 12 before touching invoice 13.
-- Fully idempotent.

CREATE TABLE IF NOT EXISTS payable_allocations (
  id                SERIAL PRIMARY KEY,
  shop_id           INTEGER NOT NULL DEFAULT 1 REFERENCES shops(id),
  payment_uuid      TEXT NOT NULL REFERENCES party_ledger(uuid) ON DELETE CASCADE,
  vendor_payable_id INTEGER NOT NULL REFERENCES vendor_payables(id) ON DELETE CASCADE,
  amount            DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alloc_payable ON payable_allocations(vendor_payable_id);
CREATE INDEX IF NOT EXISTS idx_alloc_payment ON payable_allocations(payment_uuid);
CREATE INDEX IF NOT EXISTS idx_alloc_shop    ON payable_allocations(shop_id, created_at);

-- Backfill: every existing vendor payment was applied to a single payable
-- (that is all vendor_payable_id could express), so credit that amount against
-- it. Without this, re-running the backfill would double-count nothing - but
-- invoices already marked paid would show as unsettled in the new query.
INSERT INTO payable_allocations (shop_id, payment_uuid, vendor_payable_id, amount, created_at)
SELECT 1, l.uuid, l.vendor_payable_id, l.amount, l.occurred_at
  FROM party_ledger l
 WHERE l.kind = 'payment'
   AND l.vendor_payable_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM payable_allocations a WHERE a.payment_uuid = l.uuid
   );

