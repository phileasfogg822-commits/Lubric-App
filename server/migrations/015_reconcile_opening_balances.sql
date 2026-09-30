-- 015_reconcile_opening_balances.sql
--
-- 014 gave us a ledger built purely from real transactions. Comparing it with
-- the denormalised columns exposed a real problem:
--
--   customers.credit_balance = 12500   (Hassan Traders)
--   ledger balance            =     0   (every order was paid in full)
--
-- The 12500 was written straight into the column by the sample-data seed and
-- has no sale behind it. Deleting it would quietly change a number the shop
-- already shows; keeping it as a plain column value would keep the two sources
-- permanently disagreeing.
--
-- The accounting-correct answer is an explicit OPENING balance - the khata
-- "balance b/d" that every ledger legitimately starts from. The number the
-- shop already shows is preserved, becomes explainable, and now agrees with
-- the ledger. If it really is owed, it is a genuine debt; if it was junk demo
-- data, it is visibly just one opening row that can be deleted.
--
-- Only the DIFFERENCE is booked, and only once, so this is safe to re-run.
-- Fully idempotent.

-- -- customers: what they owe us ---------------------------------------------
WITH computed AS (
  SELECT c.id,
         c.shop_id,
         COALESCE(c.credit_balance, 0) AS stored,
         COALESCE(SUM(CASE WHEN l.direction = 'debit'
                           THEN l.amount ELSE -l.amount END), 0) AS from_ledger
    FROM customers c
    LEFT JOIN party_ledger l
      ON l.party_type = 'customer' AND l.party_id = c.id
   GROUP BY c.id, c.shop_id, c.credit_balance
)
INSERT INTO party_ledger
  (uuid, shop_id, party_type, party_id, kind, direction, amount, note, occurred_at, origin)
SELECT gen_random_uuid()::text,
       shop_id,
       'customer',
       id,
       'opening',
       CASE WHEN (stored - from_ledger) > 0 THEN 'debit' ELSE 'credit' END,
       ABS(stored - from_ledger),
       'Opening balance carried over from the old customer list',
       NOW(),
       'reconcile'
  FROM computed
 WHERE ABS(stored - from_ledger) > 0.005
   AND NOT EXISTS (
     SELECT 1 FROM party_ledger l2
      WHERE l2.party_type = 'customer'
        AND l2.party_id = computed.id
        AND l2.kind = 'opening');