-- 035_warehouses_default_all.sql — a default warehouse for EVERY outlet.
--
-- 033 seeded defaults only for shops 1-2, but shops created after it ran
-- (the demo shop 4, "Demo Lubricants") have none — and a sale there hits the
-- same NULL warehouse the Windows app hit locally (reported 2026-11-24):
-- the sale's stock statements fall back to the outlet's default warehouse,
-- and with no row the fallback is NULL, so the stock_levels insert dies on
-- its NOT NULL warehouse_id (on Postgres the same statement fails the same
-- way). Locally this is repaired by ensureDefaultWarehouses in
-- src/lib/localDb.ts; this migration is the server-side half.
--
-- Re-run safe: migrate.js runs every .sql file on every container start
-- with no tracking table, so a second run must change nothing — the
-- NOT EXISTS clause skips every shop that already has an active default,
-- and ON CONFLICT(uuid) covers a same-uuid row in any case.
INSERT INTO warehouses (uuid, shop_id, name, code, is_default, active)
SELECT 'wh-default-' || s.id::text, s.id, 'Main Store', 'MAIN', TRUE, 1
  FROM shops s
 WHERE NOT EXISTS (
   SELECT 1 FROM warehouses w
    WHERE w.shop_id = s.id AND w.is_default AND w.active = 1
 )
ON CONFLICT (uuid) DO NOTHING;
