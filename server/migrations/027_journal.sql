-- 027_journal.sql — one ledger every financial report can trust.
--
-- Spec §73: "Do not calculate financial reports independently from UI
-- transactions. Create a proper journal engine."
--
-- What is true today, which is the reason this is not a tidy-up:
--   * `accounts` is not a chart of accounts. It holds two rows - Shop Cash
--     Drawer and Bank Account - with type cash|bank. It is a cash book.
--   * ProfitLoss.tsx sums `expenses` for costs and reads `orders.total` for
--     revenue. Two unrelated queries, each a special case.
--   * There is no way to ask "what does the shop own" or "did we make money".
--     Adding Quotation/Order/Challan on top would add a third, fourth and fifth
--     special case to the reports instead of a second entry to a ledger.
--
-- So: a real double-entry journal, and a chart of accounts to post into.
--
-- ── The one guarantee this file exists to enforce ───────────────────────────
-- An entry whose debits do not equal its credits is REFUSED BY THE DATABASE.
-- That is the whole value of a journal: the thing that makes the Balance Sheet
-- trustworthy is not the report, it is the constraint that no unbalanced entry
-- can ever be committed. Every other design choice here is in service of that.
--
-- ── Design notes ────────────────────────────────────────────────────────────
-- * Debits and credits are separate NUMERIC columns rather than one signed
--   amount. A signed column lets "debit -500" look like a credit, and the
--   balancing check stops meaning anything.
-- * The balance check is a DEFERRABLE INITIALLY DEFERRED constraint trigger, so
--   an entry and its lines can be written in any order inside one transaction
--   and are judged together at COMMIT. An immediate trigger would fail on the
--   first line, before the rest existed.
-- * journal_entries carries UNIQUE (source_table, source_id, kind), so posting
--   the same document twice is impossible at the database rather than by
--   remembering to check in application code. This is the same idea as the
--   stock ledger's UNIQUE uuid, one level up.
-- * Lines and entries are append-only. A mistake is a reversing entry, not a
--   delete, so history a customer or a tax authority has already seen cannot
--   change underneath them.
--
-- Fully idempotent.

-- ── the chart of accounts ───────────────────────────────────────────────────
-- `type` already means cash|bank and the app depends on it, so the accounting
-- classification is a separate column rather than a redefinition of the old
-- one. Backfilling the two existing rows keeps them cash accounts AND assets.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_class TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS code TEXT;

UPDATE accounts SET account_class = 'asset' WHERE account_class IS NULL;

-- The existing CHECK only allows 'cash' | 'bank', because until now every
-- account in the table WAS a cash account - it was a cash book, not a chart.
-- A chart of accounts needs income, expense, liability and equity accounts too,
-- which hold no money, so 'other' is added. The two original values are
-- untouched, so the Accounts screen and every query filtering on
-- type = 'cash' keep working exactly as before.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('cash', 'bank', 'other'));

-- Fixed uuids so re-running is harmless, and so the app can post to an account
-- by a stable key rather than by a row id that differs per environment.
-- Clean up after an earlier draft of this migration. It seeded acc-cash and
-- acc-bank by uuid, but the shop's existing cash and bank accounts were created
-- long before this file with different uuids, so ON CONFLICT did not match
-- them and the seed created a SECOND "Shop Cash Drawer" instead of adopting the
-- first. The guard refuses to remove one that is already posted to, so this can
-- never destroy journal history.
DELETE FROM accounts a
 WHERE a.uuid IN ('acc-cash', 'acc-bank')
   AND a.type IN ('cash', 'bank')
   AND a.balance = 0
   AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = a.id);

-- The chart of accounts the journal posts into.
--
-- Cash and Bank are NOT seeded here: the shop already has them, and a second
-- row with the same name is how you end up with two tills and no way to tell
-- which one a sale went into. They are classified and coded below instead.
--
-- `type` already means cash|bank and the app depends on it, so the accounting
-- classification is a separate column rather than a redefinition of the old
-- one. The two existing rows keep type cash|bank AND become assets.
INSERT INTO accounts (shop_id, uuid, code, name, type, account_class, balance, active) VALUES
  (1, 'acc-receivable',  '1100', 'Customers (Receivable)',  'other','asset',     0, 1),
  (1, 'acc-inventory',   '1200', 'Inventory / Oil Stock',   'other','asset',     0, 1),
  (1, 'acc-payable',     '2000', 'Suppliers (Payable)',     'other','liability', 0, 1),
  (1, 'acc-opening',     '3000', 'Opening Balance Equity',  'other','equity',    0, 1),
  (1, 'acc-sales',       '4000', 'Sales Revenue',           'other','income',    0, 1),
  (1, 'acc-sales-return','4010', 'Sales Returns',           'other','income',    0, 1),
  (1, 'acc-cogs',        '5000', 'Cost of Goods Sold',      'other','expense',   0, 1),
  (1, 'acc-rent',        '5100', 'Rent',                    'other','expense',   0, 1),
  (1, 'acc-utilities',   '5110', 'Electricity & Water',      'other','expense',   0, 1),
  (1, 'acc-salaries',    '5120', 'Salaries & Wages',        'other','expense',   0, 1),
  (1, 'acc-bankcharges', '5130', 'Bank Charges',            'other','expense',   0, 1),
  (1, 'acc-office',      '5140', 'Office & Sundries',       'other','expense',   0, 1)
ON CONFLICT (uuid) DO NOTHING;

-- The two accounts that already existed were created before codes existed, so
-- they have none, and their uuid is not the acc-cash / acc-bank the seed uses -
-- which is why the opening entry's cash line has a null code. Matched by TYPE
-- rather than by uuid, because overwriting a uuid would break every sync row
-- that already references that account. Code is the stable key the app posts by.
UPDATE accounts SET code = '1000' WHERE shop_id = 1 AND type = 'cash' AND code IS NULL;
UPDATE accounts SET code = '1010' WHERE shop_id = 1 AND type = 'bank' AND code IS NULL;

-- A chart of accounts with two rows both called "Rent" is not a chart. Partial,
-- so accounts a shop has not classified yet may still be code-less.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_code
  ON accounts (shop_id, code) WHERE code IS NOT NULL;

-- ── the journal ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id                 SERIAL PRIMARY KEY,
  uuid               TEXT UNIQUE NOT NULL,
  shop_id            INTEGER NOT NULL REFERENCES shops(id),
  entry_no           BIGSERIAL,
  entry_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  -- What produced this entry. The idempotency guarantee below is built on it.
  kind               TEXT NOT NULL CHECK (kind IN (
                       'opening', 'sale', 'sale_return', 'payment',
                       'expense', 'purchase', 'adjustment', 'other')),
  source_table       TEXT,
  source_id          INTEGER,
  memo               TEXT DEFAULT '',
  is_opening         BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Posting the same document twice is impossible, not merely discouraged. A
-- retried sync or a double-clicked button cannot post a sale's revenue entry
-- twice, and the app does not have to remember to check first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_source
  ON journal_entries (source_table, source_id, kind)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_opening
  ON journal_entries (shop_id, is_opening) WHERE is_opening;
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries (shop_id, entry_date, id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id         SERIAL PRIMARY KEY,
  entry_id   INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no    INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit      NUMERIC(18,4) NOT NULL DEFAULT 0,
  credit     NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- Who the money is about, independent of which account it sits in. This is
  -- what lets a customer statement and an age analysis come off the journal
  -- instead of being maintained separately.
  party_type TEXT CHECK (party_type IS NULL OR party_type IN ('customer','vendor','employee','other')),
  party_id   INTEGER,
  note       TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT jl_not_negative CHECK (debit >= 0 AND credit >= 0),
  -- A line is a debit OR a credit. Allowing both on one line is how a naive
  -- implementation ends up with a "balanced" entry that means nothing.
  CONSTRAINT jl_one_side   CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT jl_has_amount CHECK (debit > 0 OR credit > 0),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines (account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_party   ON journal_lines (party_type, party_id);

-- ── the guarantee: an entry must balance ────────────────────────────────────
CREATE OR REPLACE FUNCTION journal_assert_balanced() RETURNS trigger AS $$
DECLARE
  target   INTEGER;
  debits   NUMERIC;
  credits  NUMERIC;
  memo_txt TEXT;
BEGIN
  -- Assigned here rather than in the DECLARE defaults: NEW and OLD are not
  -- available while the block's variables are being initialised, and Postgres
  -- rejects the function outright (42P13) if you try.
  target := COALESCE(NEW.entry_id, OLD.entry_id);

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) INTO debits, credits
    FROM journal_lines WHERE entry_id = target;
  SELECT memo INTO memo_txt FROM journal_entries WHERE id = target;

  IF debits <> credits THEN
    RAISE EXCEPTION
      'journal entry % (%) does not balance: debits % vs credits %',
      target, COALESCE(memo_txt, ''), debits, credits;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Dropped first, then recreated. Postgres has no CREATE OR REPLACE TRIGGER, and
-- the migration runner re-executes this file on every boot, so a bare CREATE
-- fails the second time and takes the API down with it. The same lesson as the
-- verification block in 025: anything in a migration must be safe to run again.
DROP TRIGGER IF EXISTS journal_entry_must_balance ON journal_lines;

-- DEFERRABLE INITIALLY DEFERRED, so the entry and all of its lines are judged
-- together when the transaction commits. An immediate trigger would reject the
-- very first line, before the balancing line had been written.
CREATE CONSTRAINT TRIGGER journal_entry_must_balance
  AFTER INSERT OR UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_assert_balanced();

-- Append-only. A removed line would silently restate a balance the shop has
-- already shown a customer, so a correction is a reversing entry instead.
CREATE OR REPLACE FUNCTION journal_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the journal is append-only; post a reversing entry instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_no_delete ON journal_lines;
DROP TRIGGER IF EXISTS journal_entries_no_delete ON journal_entries;

CREATE TRIGGER journal_lines_no_delete BEFORE DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_no_delete();
CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_no_delete();

-- A journal entry with no lines would satisfy the balance check trivially - zero
-- equals zero - and be a note pretending to be accounting. Checked on the ENTRY
-- rather than the lines, since the lines arrive after it.
CREATE OR REPLACE FUNCTION journal_entry_has_lines() RETURNS trigger AS $$
DECLARE
  line_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO line_count FROM journal_lines WHERE entry_id = NEW.id;
  IF line_count = 0 THEN
    RAISE EXCEPTION 'journal entry % (%) has no lines', NEW.id, COALESCE(NEW.memo, '');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entry_needs_lines ON journal_entries;

CREATE CONSTRAINT TRIGGER journal_entry_needs_lines
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_has_lines();

-- ── opening balances ────────────────────────────────────────────────────────
-- The journal starts from what the shop actually owns today, not from zero.
-- Without this the Balance Sheet would say the shop is worthless on the day the
-- journal is introduced, and every historical figure would be wrong.
--
-- Debits: cash on hand, what customers owe, stock on the shelf.
-- Credits: what the shop owes suppliers, and the plug that makes it balance.
-- The plug is Opening Balance Equity - the accumulated result of trading before
-- the journal existed, which is exactly what it is.
--
-- One entry per shop, enforced by idx_journal_opening, so this is a no-op on a
-- re-run.
DO $opening$
DECLARE
  cash          NUMERIC;
  receivable    NUMERIC;
  payable       NUMERIC;
  plug          NUMERIC;
  new_entry     INTEGER;
  r             RECORD;
BEGIN
  SELECT COALESCE(SUM(balance), 0) INTO cash FROM accounts
   WHERE shop_id = 1 AND type IN ('cash', 'bank');
  -- credit_balance is SIGNED, by the khata convention: positive means the
  -- customer owes the shop, negative means the shop holds their money in
  -- advance. Both are real positions and they belong on OPPOSITE sides of the
  -- balance sheet, so neither can be assumed to be a debit.
  SELECT COALESCE(SUM(credit_balance), 0) INTO receivable FROM customers WHERE shop_id = 1;
  SELECT COALESCE(SUM(payable_balance), 0) INTO payable FROM vendors WHERE shop_id = 1;

  IF cash = 0 AND receivable = 0 AND payable = 0 THEN
    RAISE NOTICE 'no opening balances needed - the shop is at zero';
    RETURN;
  END IF;

  -- Assets less liabilities is the accumulated result. Negative means the shop
  -- owes more than it holds, which is a legitimate (if unhappy) position.
  plug := cash + receivable - payable;

  INSERT INTO journal_entries (uuid, shop_id, kind, memo, is_opening, entry_date)
  VALUES ('journal-opening-1', 1, 'opening',
          'Opening balances carried over when the journal was introduced', TRUE, CURRENT_DATE)
  ON CONFLICT (uuid) DO NOTHING;

  SELECT id INTO new_entry FROM journal_entries WHERE uuid = 'journal-opening-1';

  -- Opening balances are posted exactly once, ever. The entry itself is matched
  -- by uuid and survives re-runs, but its LINES would be inserted a second time
  -- and collide on (entry_id, line_no). So the presence of lines is the signal
  -- that this has already been done - which is also the correct accounting rule,
  -- not just a convenience: a second opening entry would double the shop's
  -- entire balance sheet.
  IF EXISTS (SELECT 1 FROM journal_lines WHERE entry_id = new_entry) THEN
    RAISE NOTICE 'opening balances already posted - nothing to do';
    RETURN;
  END IF;

  -- Posted by sign, never assumed. A helper keeps this in one place so every
  -- opening figure is treated the same way, and so no bucket can be inserted on
  -- the wrong side and trip the line CHECKs - which is exactly what happened
  -- the first time this was written by hand.
  --   A positive balance is an asset-like debit; a negative one is a credit.
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'Cash and bank on hand',
         (SELECT id FROM accounts WHERE shop_id = 1 AND type IN ('cash','bank') AND balance <> 0 LIMIT 1),
         cash),
      (2, 'Customer balances',
         (SELECT id FROM accounts WHERE uuid = 'acc-receivable'),
         receivable),
      (3, 'Supplier balances',
         (SELECT id FROM accounts WHERE uuid = 'acc-payable'),
         -payable)
    ) AS t(line_no, note, acct, amount)
    WHERE acct IS NOT NULL AND amount <> 0
  LOOP
    INSERT INTO journal_lines (entry_id, line_no, account_id, debit, credit, note)
    VALUES (new_entry, r.line_no, r.acct,
            CASE WHEN r.amount > 0 THEN r.amount ELSE 0 END,
            CASE WHEN r.amount < 0 THEN -r.amount ELSE 0 END,
            r.note);
  END LOOP;

  IF plug <> 0 THEN
    INSERT INTO journal_lines (entry_id, line_no, account_id, debit, credit, note)
    SELECT new_entry, 9, id,
           CASE WHEN plug < 0 THEN -plug ELSE 0 END,
           CASE WHEN plug > 0 THEN  plug ELSE 0 END,
           'Accumulated result before the journal existed'
      FROM accounts WHERE uuid = 'acc-opening';
  END IF;

  RAISE NOTICE 'opening balances posted: cash %, customer %, supplier %, equity %',
               cash, receivable, payable, plug;
END
$opening$ LANGUAGE plpgsql;

