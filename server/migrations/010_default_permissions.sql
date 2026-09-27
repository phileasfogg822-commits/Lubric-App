-- 010_default_permissions.sql — backfill users.permissions from their role.
-- Idempotent: only touches rows with no permissions yet, so migrate.js can
-- replay this file on every boot without clobbering hand-tuned access.
--
-- Keys mirror src/lib/permissions.ts. Sorted so rows diff cleanly.

-- Make sure the column exists even on a database that predates 009.
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '[]';

-- Admin & owner — everything (they also bypass checks in code).
UPDATE users SET permissions =
  '["accounts","bill.delete","bill.edit","bill.void","catalog.manage","customers","dashboard","expenses.manage","inspections","pos.create","purchase.manage","reports","sales_history","shop.manage","team.manage","vendors"]'
WHERE role IN ('admin', 'owner')
  AND (permissions IS NULL OR permissions = '' OR permissions = '[]');

-- Manager — everything except managing the team, shop settings and deleting bills.
UPDATE users SET permissions =
  '["accounts","bill.edit","bill.void","catalog.manage","customers","dashboard","expenses.manage","inspections","pos.create","purchase.manage","reports","sales_history","vendors"]'
WHERE role = 'manager'
  AND (permissions IS NULL OR permissions = '' OR permissions = '[]');

-- Cashier — can generate bills and look them up, but NOT edit, void or delete them.
UPDATE users SET permissions =
  '["customers","dashboard","pos.create","sales_history"]'
WHERE role NOT IN ('admin', 'owner', 'manager')
  AND (permissions IS NULL OR permissions = '' OR permissions = '[]');

-- Ensure any future INSERT that omits the column still lands on a valid array.
ALTER TABLE users ALTER COLUMN permissions SET DEFAULT '[]';
