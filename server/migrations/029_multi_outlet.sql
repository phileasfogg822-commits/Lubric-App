-- 029_multi_outlet.sql — one login, several outlets, isolation in the database.
--
-- Agreed sequence: this foundation first, so everything built after it is
-- outlet-aware once instead of being rebuilt when outlets arrive.
--
-- ── Why outlets are `shops` rows and not a new `outlets` table ──────────────
-- Every business table already carries shop_id (30 of them). Making a second
-- outlet a second `shops` row gives scoping everywhere for the cost of one
-- insert. A separate outlet table would have required adding outlet_id to all
-- 30 tables, re-pointing every foreign key, and rewriting every filter - for a
-- result that is exactly what shop_id already means.
--
-- ── The trap this file is built to avoid ────────────────────────────────────
-- The app connects as `lubric`, which is a SUPERUSER with BYPASSRLS. Postgres
-- bypasses row-level security unconditionally for superusers - no policy, and
-- not even FORCE ROW LEVEL SECURITY, can stop it. So adding policies while the
-- app still connects as `lubric` would produce isolation tests that PASS while
-- the app still reads every outlet's data. That is worse than no isolation,
-- because it manufactures confidence.
--
-- So this file creates the role but does NOT enable the policies yet. Enabling
-- happens in a later migration, after the app has been switched to the new role
-- and proven to set the shop context on every request. Doing both at once is how
-- a shop goes to zero rows on a deploy.
--
-- ── What is deliberately NOT covered by RLS ─────────────────────────────────
-- identity tables: shops, users, devices, user_shops, settings, role_permissions.
-- RLS on `users` would stop you reading your own user record at login, before
-- anything is known about which outlet you are in - a chicken-and-egg that would
-- need a bypass path, and a bypass path defeats the point. These tables are not
-- business data and are already gated by token and role.
--
-- Fully idempotent.

-- ── the outlet that already exists ──────────────────────────────────────────
INSERT INTO shops (id, name, address, phone, currency, language)
VALUES (1, 'Zafar Lubricants', 'Main Bazaar Road, Lahore', '0300-1234567', 'PKR', 'en')
ON CONFLICT (id) DO NOTHING;

-- Placeholder second outlet, so the filter and the isolation test have something
-- real to operate on. No data is seeded into it: an empty outlet that proves
-- isolation is more useful than one with sample rows that could be mistaken for
-- the shop's real stock.
INSERT INTO shops (id, name, address, phone, currency, language)
VALUES (2, 'Zafar Lubricants - Outlet 2', NULL, NULL, 'PKR', 'en')
ON CONFLICT (id) DO NOTHING;

-- ── which users may enter which outlet ──────────────────────────────────────
-- users.shop_id is single-valued and stays as the user's HOME outlet, so
-- nothing that reads it today breaks. This table is what turns one login into
-- access to several: every outlet the user may enter, with their role there.
CREATE TABLE IF NOT EXISTS user_shops (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id    INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  role       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, shop_id)
);

-- Existing users keep access to whatever they were on, so this deploy cannot
-- lock anyone out of the outlet they use today.
INSERT INTO user_shops (user_id, shop_id, role)
SELECT id, shop_id, role FROM users
WHERE shop_id IS NOT NULL
ON CONFLICT (user_id, shop_id) DO NOTHING;

-- A user may be active in another outlet while staying home in their own.
CREATE INDEX IF NOT EXISTS idx_user_shops_shop ON user_shops (shop_id);

-- ── the application role that RLS can actually constrain ────────────────────
-- NOSUPERUSER and NOBYPASSRLS are the whole point: they are the two attributes
-- that let Postgres enforce row security on this role at all.
--
-- The password here MUST match DB_APP_PASSWORD on the api container. Migrations
-- are SQL and cannot read the environment, so the value is fixed in this file
-- and mirrored in docker-compose. Overriding it means editing both - called out
-- here because a secret committed to a migration is a real, if unavoidable,
-- compromise for this deployment setup.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lubric_app') THEN
    CREATE ROLE lubric_app NOSUPERUSER NOBYPASSRLS LOGIN PASSWORD 'lubric_app_pw';
    RAISE NOTICE 'created role lubric_app (NOSUPERUSER NOBYPASSRLS)';
  END IF;
END
$role$;

-- The superuser `lubric` keeps ownership and full rights for migrations, where
-- bypassing row security is exactly what is wanted: schema changes, backfills
-- and reconciliation must see every outlet regardless of context.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lubric_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lubric_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lubric_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lubric_app;

-- ── the policies ────────────────────────────────────────────────────────────
-- Generated by looping over every business table that has shop_id rather than
-- naming all 30 by hand: a table added later is covered automatically the next
-- time migrations run, and they run on every boot. Naming them by hand is how
-- the 31st table ends up unprotected and nobody notices.
--
-- Read:    USING   - a row is visible only in its own outlet.
-- Write:   WITH CHECK - you cannot INSERT or UPDATE a row into another outlet.
--
-- current_setting('app.shop_id', true) returns NULL when the context was never
-- set. NULL = NULL is NULL, not TRUE, so the row is hidden. The isolation FAILS
-- CLOSED: forgetting to set the context yields zero rows and an obvious symptom,
-- never a leak of another outlet's data. NULLIF also guards the case where the
-- context is set to an empty string, which would otherwise raise on the cast.
--
-- Created here, ENABLED in a later migration, so the app can be switched to the
-- new role and verified before enforcement is switched on.
DO $policies$
DECLARE
  t          record;
  -- Named skip_tables, not `excluded`: EXCLUDED is a reserved word in
  -- PostgreSQL (used by ON CONFLICT DO UPDATE SET) and is rejected as a
  -- variable name.
  skip_tables text[] := ARRAY[
    'shops', 'users', 'devices', 'user_shops', 'settings', 'role_permissions',
    -- Deployment config, not outlet data: shop_id is mostly NULL, branding is
    -- read pre-login and flags gate nav for every session. The generic outlet
    -- policy would hide the global (NULL) rows outright. Same class as
    -- `settings`. 034 repairs anything an earlier boot already made here.
    'config', 'feature_flags'
  ];
  made       INTEGER := 0;
BEGIN
  FOR t IN
    SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      JOIN pg_class pc
        ON pc.relname = c.table_name
       AND pc.relnamespace = 'public'::regnamespace
     WHERE c.table_schema = 'public'
       AND c.column_name = 'shop_id'
       AND pc.relkind = 'r'
       AND NOT (c.table_name = ANY(skip_tables))
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS shop_isolation ON %I', t.table_name);
    EXECUTE format(
      'CREATE POLICY shop_isolation ON %I
         USING (shop_id = NULLIF(current_setting(%L, true), '''')::int)
         WITH CHECK (shop_id = NULLIF(current_setting(%L, true), '''')::int)',
      t.table_name, 'app.shop_id', 'app.shop_id');
    made := made + 1;
  END LOOP;

  RAISE NOTICE 'shop_isolation policies prepared on % table(s)', made;
  RAISE NOTICE 'RLS NOT enabled yet - run 030 after the app connects as lubric_app';
END
$policies$;
