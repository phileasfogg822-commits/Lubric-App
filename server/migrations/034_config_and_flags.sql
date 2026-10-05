-- 034_config_and_flags.sql — Level A deployment config and feature flags
--
-- ── config: Level A deployment settings ────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  key      TEXT PRIMARY KEY,
  value    TEXT NOT NULL DEFAULT '',
  shop_id  INTEGER REFERENCES shops(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── feature_flags: per-tenant toggles ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (
  key      TEXT PRIMARY KEY,
  enabled  BOOLEAN NOT NULL DEFAULT true,
  shop_id  INTEGER REFERENCES shops(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── default config rows ────────────────────────────────────────────────────
INSERT INTO config (key, value, shop_id) VALUES
  ('app_name', 'LubricApp', NULL),
  ('primary_color', '#2563EB', NULL),
  ('api_endpoint', '', NULL),
  ('db_environment', 'production', NULL),
  ('payment_gateway', '', NULL),
  ('support_email', '', NULL),
  ('support_phone', '', NULL),
  ('included_modules', '["dashboard","pos.create","sales_history","catalog.manage","customers","vendors","accounts","expenses.manage","purchase.manage","inspections","reports","profit_loss","team.manage","shop.manage"]', NULL),
  ('default_branding', '', NULL)
ON CONFLICT (key) DO NOTHING;

-- ── default feature flags rows ────────────────────────────────────────────
INSERT INTO feature_flags (key, enabled, shop_id) VALUES
  ('dashboard', true, NULL),
  ('pos.create', true, NULL),
  ('sales_history', true, NULL),
  ('catalog.manage', true, NULL),
  ('customers', true, NULL),
  ('vendors', true, NULL),
  ('accounts', true, NULL),
  ('expenses.manage', true, NULL),
  ('purchase.manage', true, NULL),
  ('inspections', true, NULL),
  ('reports', true, NULL),
  ('profit_loss', true, NULL),
  ('team.manage', true, NULL),
  ('shop.manage', true, NULL)
ON CONFLICT (key) DO NOTHING;

-- ── grants ─────────────────────────────────────────────────────────────────
-- 029's ALTER DEFAULT PRIVILEGES already covers tables the migration role
-- creates, but state it outright so a role change can never lock lubric_app
-- out of the config it reads on every boot. GRANT is idempotent.
GRANT SELECT, INSERT, UPDATE, DELETE ON config, feature_flags TO lubric_app;

-- ── outlet-isolation exemption (repair) ─────────────────────────────────────
-- config/feature_flags carry shop_id, so when they exist BEFORE 029/030 run —
-- which is every boot after the first — the generic outlet-policy loop used to
-- make a shop_isolation policy for them and enable RLS on them. That policy
-- hides the global (shop_id IS NULL) rows and blocks their INSERTs: reads
-- returned zero rows and PATCH failed with "violates row-level security
-- policy", exactly what e2e_config_flags caught on the second boot.
--
-- They are deployment config, same class as `settings` (skip-listed in 029
-- and 030 from now on). This repairs anything earlier boots already made, so
-- every migration stays idempotent and the runner can re-execute it freely.
-- When per-tenant overrides become real in a later phase, give these tables a
-- deliberate NULL-tolerant policy instead of rejoining the generic loop.
DROP POLICY IF EXISTS shop_isolation ON config;
DROP POLICY IF EXISTS shop_isolation ON feature_flags;
ALTER TABLE config DISABLE ROW LEVEL SECURITY;
ALTER TABLE config NO FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_flags DISABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags NO FORCE ROW LEVEL SECURITY;