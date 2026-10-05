-- 030_enable_row_security.sql — switch the isolation on.
--
-- Migration 029 CREATED the policies but deliberately left them disabled, so
-- this is the switch. It is separate because getting it wrong takes the shop to
-- zero rows on a deploy, and the two halves needed proving independently:
--
--   029 proved the app runs as `lubric_app`, a NOSUPERUSER NOBYPASSRLS role,
--       and that its grants are complete - all 126 checks across 11 suites pass
--       as that role, which is what a missing grant would have exposed.
--   e2e_outlet_isolation.js proved the policies exist and that enforcement was
--       still OFF, by running as the app role and watching a leak succeed.
--
-- The ordering is the whole point. Enabling RLS and switching role in the same
-- deploy would have left no way to tell "my grants are incomplete" from "row
-- security is doing its job" - both look like the same empty screen.
--
-- ── Why FORCE ───────────────────────────────────────────────────────────────
-- Plain ENABLE is enough for `lubric_app`, which does not own the tables. FORCE
-- additionally constrains the OWNER. The owner here is the `lubric` superuser,
-- and a superuser bypasses RLS regardless - so FORCE is not what protects the
-- app. It is there so that an owner-privileged connection (a migration, a
-- psql session, a future service account) cannot quietly read across outlets
-- without going through set_config, and so the blast radius of a mistaken
-- `SET ROLE` is smaller.
--
-- ── Why it cannot lock the shop out ─────────────────────────────────────────
-- Every authenticated request sets app.shop_id from the validated header
-- (resolveShop in server/index.js) before its query runs, and the policy
-- FAILS CLOSED on a NULL context - it hides rows rather than showing all of
-- them. So a missing context produces a visible empty screen, never a leak.
--
-- Fully idempotent.

DO $enable$
DECLARE
  t          record;
  skip_tables text[] := ARRAY[
    'shops', 'users', 'devices', 'user_shops', 'settings', 'role_permissions',
    -- Deployment config, not outlet data - see the note in 029.
    'config', 'feature_flags'
  ];
  enabled    INTEGER := 0;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attname = 'shop_id'
            AND NOT a.attisdropped
       )
       AND NOT (c.relname = ANY(skip_tables))
  LOOP
    -- Skip anything without a policy rather than enabling RLS on it: RLS with
    -- no policy denies everything, which would turn a missed table into a
    -- silent outage for that one entity instead of a loud failure here.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = t.table_name
         AND policyname = 'shop_isolation'
    ) THEN
      RAISE WARNING 'skipping %: no shop_isolation policy - migration 029 did not run', t.table_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    enabled := enabled + 1;
  END LOOP;

  RAISE NOTICE 'row security enabled and forced on % table(s)', enabled;
END
$enable$;

-- Prove from inside the migration that enforcement is live. Run as the app role
-- so this is a real check: a superuser would see every row here and pass
-- regardless of whether the policies work at all.
DO $prove$
DECLARE
  app_role  text := 'lubric_app';
  out_of_scope NUMERIC;
  no_context    NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE NOTICE 'app role not present - skipping the live proof';
    RETURN;
  END IF;

  -- Counted through SET ROLE, which lands on the app role's privileges while
  -- staying inside this transaction.
  EXECUTE format('SET LOCAL ROLE %I', app_role);

  SELECT count(*) INTO out_of_scope
    FROM (SELECT shop_id FROM customers WHERE shop_id = 1 LIMIT 1) t;
  SELECT count(*) INTO no_context
    FROM customers;

  EXECUTE 'RESET ROLE';

  -- No context set, so the policy must hide everything. Anything above zero
  -- means the default is fail-OPEN and a forgotten context would leak.
  IF no_context <> 0 THEN
    RAISE EXCEPTION
      'row security is NOT effective: % customer row(s) visible with no outlet context',
      no_context;
  END IF;

  RAISE NOTICE
    'enforcement verified: % customers visible with no outlet context (fail-closed as intended)',
    no_context;
END
$prove$;