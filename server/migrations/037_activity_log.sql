-- 037_activity_log.sql — team activity log (Umar, 2026-11-28).
--
-- Every action a team member takes — add / edit / delete / view / void /
-- login — lands here with the member's name, so the admin-only Activity
-- page can show who did what, when. The name is denormalised into the
-- row: the log stays readable if the member is later renamed or removed.
--
-- Fully idempotent: CREATE TABLE / INDEX IF NOT EXISTS, and the RLS
-- statements re-assert what migrations 029/030 already do on every boot
-- (029's policy loop and 030's enable loop both re-run over every table
-- with shop_id, so a later boot would add these anyway — this file makes
-- the table protected from the very first boot it exists on, instead of
-- waiting for the next one). No UPDATE/INSERT runs here at all.
CREATE TABLE IF NOT EXISTS activity_log (
  id         SERIAL PRIMARY KEY,
  shop_id    INTEGER NOT NULL DEFAULT 1,
  user_id    INTEGER,
  user_name  TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(shop_id, created_at DESC, id DESC);
-- Grants ride on 029's ALTER DEFAULT PRIVILEGES (new tables inherit them),
-- but the RLS switch and the outlet policy do not: enable both here.
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_isolation ON activity_log;
CREATE POLICY shop_isolation ON activity_log
  USING (shop_id = NULLIF(current_setting('app.shop_id', true), '')::int)
  WITH CHECK (shop_id = NULLIF(current_setting('app.shop_id', true), '')::int);
