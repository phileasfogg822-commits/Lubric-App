-- 020_post_field_collections.sql — put field collections into the real books.
--
-- A collection taken on a phone was stored and then simply sat there. It did
-- not touch the cash account and it never appeared in the customer's Khata,
-- even though party_ledger has carried a `cash_movement_id` column since
-- migration 014 precisely to link the two. The link was designed and never
-- made.
--
-- customer_uuid: the phone already picks the customer from the list it caches
-- from the shop, but only sent the free-text name. The uuid is what actually
-- identifies the party; the name is only a hint.
--
-- posted_at: the idempotency guard. Every posting step (ledger row, party
-- balance, account balance, account transaction) is claimed by flipping this
-- in a single conditional UPDATE, so a retried push - which the sync protocol
-- performs by design, since it upserts on uuid - can never double-count a
-- collection. A failed posting rolls back with the claim.
--
-- Backfill: collections already sitting unposted are booked to the shop's cash
-- account. None of them can be linked to a customer (the name was discarded
-- before migration 019), so they are booked as money in and flagged in the
-- Field Activity page as unlinked rather than guessed at.
-- Fully idempotent.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS customer_uuid TEXT;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_cashmov_customer ON cash_movements(customer_uuid);
CREATE INDEX IF NOT EXISTS idx_cashmov_unposted ON cash_movements(posted_at) WHERE posted_at IS NULL;

DO $backfill$
DECLARE
  cm RECORD;
  cash_account INTEGER;
  claimed BOOLEAN;
BEGIN
  SELECT id INTO cash_account
    FROM accounts
   WHERE shop_id = 1 AND type = 'cash' AND active = 1
   ORDER BY id LIMIT 1;

  IF cash_account IS NULL THEN
    RAISE NOTICE 'no active cash account - field collections will post when one exists';
    RETURN;
  END IF;

  FOR cm IN
    SELECT id, amount, note FROM cash_movements
     WHERE kind = 'collection' AND posted_at IS NULL
     FOR UPDATE
  LOOP
    UPDATE cash_movements SET posted_at = NOW()
     WHERE id = cm.id AND posted_at IS NULL;
    claimed := FOUND;
    IF NOT claimed THEN
      CONTINUE;
    END IF;

    UPDATE accounts SET balance = balance + cm.amount WHERE id = cash_account;
    INSERT INTO account_transactions (account_id, amount, type, reference)
    VALUES (cash_account, cm.amount, 'in', 'Field collection ' || substr(cm.id::text, 1, 8));
  END LOOP;
END
$backfill$;