-- Vehicle details captured on the POS sale screen.
-- Idempotent: migrate.js replays every .sql file on each boot.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS model_year TEXT DEFAULT '';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color       TEXT DEFAULT '';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "condition" TEXT DEFAULT '';