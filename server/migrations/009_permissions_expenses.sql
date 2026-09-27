-- 009_permissions_expenses.sql — per-user permission keys + expense subcategories.
-- Idempotent: migrate.js replays every file on each boot.

-- JSON array of permission keys, e.g. '["pos","sales_history","bills.edit"]'.
-- Admin/owner bypass checks in the UI; everyone else is gated by this list.
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '[]';

-- Structured expense breakdown (Shop > Rent, Food > Tea, Commute > Owner, ...)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subcategory TEXT DEFAULT '';
