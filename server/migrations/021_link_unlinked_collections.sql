-- 021_link_unlinked_collections.sql — self-heal for the gap in 020's backfill.
--
-- 020 posted already-synced collections to cash but deliberately did not guess
-- at a customer. That leaves a real hole: any collection that syncs in the
-- window between a phone's push and a server deploy is banked as cash and never
-- linked to the customer's Khata. It is exactly what happened to the PKR 40,000
-- collection from Zafar Iqbal - pushed at 06:28:53, API restarted with the
-- posting code at 06:39:58, and the cash backfill claimed it at 06:39:59.
--
-- So this completes the link for every collection that has been banked but not
-- attributed. It never touches cash: that money is already counted, and the
-- only thing missing is the party it belongs to.
--
-- Resolution is uuid first, then an exact case-insensitive name match. Where
-- neither works the row is simply skipped and the Field Activity page shows it
-- as unlinked for a human to match - guessing a party from a fuzzy name would
-- be worse than leaving it visible.
--
-- Fully idempotent: it only ever considers a collection that has NO ledger row,
-- and the ledger uuid is derived from the movement's own, so a repeat run does
-- nothing.
DO $repair$
DECLARE
  cm RECORD;
  cust RECORD;
  linked INTEGER;
  note_text TEXT;
BEGIN
  FOR cm IN
    SELECT m.id, m.uuid, m.amount, m.note, m.occurred_at,
           m.customer_uuid, m.customer_name
      FROM cash_movements m
     WHERE m.kind = 'collection'
       AND m.posted_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM party_ledger l WHERE l.uuid = 'cm-' || m.uuid)
  LOOP
    cust := NULL;

    IF cm.customer_uuid IS NOT NULL AND cm.customer_uuid <> '' THEN
      SELECT c.id, c.name INTO cust
        FROM customers c
       WHERE c.shop_id = 1 AND c.uuid = cm.customer_uuid
       LIMIT 1;
    END IF;

    IF cust IS NULL AND cm.customer_name IS NOT NULL AND cm.customer_name <> '' THEN
      SELECT c.id, c.name INTO cust
        FROM customers c
       WHERE c.shop_id = 1 AND lower(c.name) = lower(cm.customer_name)
       LIMIT 1;
    END IF;

    -- No match: leave it for the shop to attribute rather than guess.
    CONTINUE WHEN cust IS NULL;

    note_text := COALESCE(NULLIF(cm.note, ''), 'Collection from ' || cust.name);

    INSERT INTO party_ledger
      (uuid, shop_id, party_type, party_id, kind, direction, amount,
       cash_movement_id, note, occurred_at, origin)
    VALUES
      ('cm-' || cm.uuid, 1, 'customer', cust.id, 'payment', 'credit', cm.amount,
       cm.id, note_text, cm.occurred_at, 'mobile')
    ON CONFLICT (uuid) DO NOTHING
    RETURNING id INTO linked;

    -- Only move the balance if a row really was inserted, so a repeated run can
    -- never double-credit the customer.
    IF linked IS NOT NULL THEN
      UPDATE customers
         SET credit_balance = COALESCE(credit_balance, 0) - cm.amount
       WHERE id = cust.id;
      RAISE NOTICE 'linked collection % to customer %', cm.uuid, cust.name;
    END IF;
  END LOOP;
END
$repair$;