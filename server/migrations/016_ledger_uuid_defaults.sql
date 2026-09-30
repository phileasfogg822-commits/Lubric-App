-- 016_ledger_uuid_defaults.sql
--
-- 014 created the ledger tables with `uuid TEXT UNIQUE NOT NULL` and NO default,
-- which only works if every INSERT supplies one. Clients do supply one (uuid is
-- the sync key, see 012_sync), but anything writing from the server side — the
-- reconciliation rows, a maintenance script, the e2e test — fails on the NOT NULL
-- with an error that says nothing about the cause.
--
-- This is the same convention 012_sync already uses for every replicated table:
--   uuid TEXT DEFAULT gen_random_uuid()::text
-- An explicitly supplied uuid still wins, so sync keys and the existing rows are
-- untouched. Fully idempotent.
--
-- commitments/commitment_items get the default now as well so the field app can
-- create bookings with the same client-generated-uuid pattern as everything else.

ALTER TABLE party_ledger     ALTER COLUMN uuid SET DEFAULT gen_random_uuid()::text;
ALTER TABLE commitments      ALTER COLUMN uuid SET DEFAULT gen_random_uuid()::text;
ALTER TABLE commitment_items ALTER COLUMN uuid SET DEFAULT gen_random_uuid()::text;
