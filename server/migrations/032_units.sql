-- 032_units.sql — units as data, not as a string to be guessed at.
--
-- Spec §25 (unit), §28 (unit_conversion), §238 (quantity precision).
--
-- What exists instead: products.unit is free text holding 'piece' or 'drum'
-- and is read NOWHERE in the app. The quantity semantics that actually matter
-- live in products.packing ('4L', '1kg', '500ml', '1pc') and were parsed by a
-- regex in POSCart.tsx.
--
-- That regex had no test, and the test written to lock it down found two real
-- bugs on its first run:
--
--   * "1kg" parsed to 1 and, having no "ml", was reported as ONE LITRE - a
--     weight compared against an engine's oil capacity in litres. Harmless only
--     by accident: grease is not poured into an engine.
--   * "-4L" stripped its own minus sign and parsed as 4 litres.
--
-- Both are fixed in src/lib/units.ts, with isVolumePack() separating a volume
-- from a weight or a count. This migration gives those distinctions a home in
-- the database, so the next pack type is configured rather than reverse-
-- engineered from a string.
--
-- Deliberately ADDITIVE. products.packing and products.unit are untouched and
-- remain the fallback, so nothing about how a product is priced or pro-rated
-- changes on this deploy - the same approach that made the price-list migration
-- safe to ship to a live shop.
--
-- Fully idempotent.

CREATE TABLE IF NOT EXISTS units (
  id             SERIAL PRIMARY KEY,
  uuid           TEXT UNIQUE NOT NULL,
  shop_id        INTEGER REFERENCES shops(id),
  name           TEXT NOT NULL,
  plural         TEXT,
  abbreviation   TEXT,
  -- The distinction the old regex got wrong. A weight is not a volume, and a
  -- count is neither, so a pack is only pro-rated against an engine's oil
  -- capacity when this says 'volume'.
  dimension      TEXT NOT NULL DEFAULT 'count'
                 CHECK (dimension IN ('volume', 'weight', 'count', 'length', 'time')),
  -- How many decimal places a quantity in this unit can carry (spec §238).
  -- Oil by the litre needs 4.5; a filter has no meaningful half of one.
  decimal_places INTEGER NOT NULL DEFAULT 0 CHECK (decimal_places BETWEEN 0 AND 4),
  -- Litres per unit, when the unit is a volume. This is what turns "20L" into
  -- 20 and "500ml" into 0.5 as DATA rather than as a regex.
  litres_each    NUMERIC(18,4),
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_units_shop ON units (shop_id, active);
-- Two units cannot share a name: "Litre" and "litre" as separate rows is how a
-- conversion ends up defined against the wrong one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_name ON units (lower(name));

-- Conversions between units, so buying a drum and selling litres reconciles.
-- Only pairs that actually exist are stored; the absence of a row means "no
-- conversion", never a default of 1.
CREATE TABLE IF NOT EXISTS unit_conversions (
  id             SERIAL PRIMARY KEY,
  uuid           TEXT UNIQUE NOT NULL,
  from_unit_id   INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  to_unit_id     INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  -- How many `to` units make one `from` unit. Litre -> millilitre is 1000.
  multiplier     NUMERIC(18,6) NOT NULL CHECK (multiplier > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uc_no_self CHECK (from_unit_id <> to_unit_id),
  UNIQUE (from_unit_id, to_unit_id)
);

-- ── the units this shop actually trades in ──────────────────────────────────
INSERT INTO units (uuid, shop_id, name, plural, abbreviation, dimension, decimal_places, litres_each) VALUES
  ('unit-piece',       1, 'Piece',       'Pieces',        'pc',  'count',  0, NULL),
  ('unit-litre',       1, 'Litre',       'Litres',        'L',   'volume', 2, 1),
  ('unit-ml',          1, 'Millilitre',  'Millilitres',   'ml',  'volume', 1, 0.001),
  ('unit-kg',          1, 'Kilogram',    'Kilograms',     'kg',  'weight', 2, NULL),
  ('unit-gram',        1, 'Gram',        'Grams',         'g',   'weight', 0, NULL),
  ('unit-litre_drum',  1, 'Litre drum',  'Litre drums',   'drum','volume', 1, 20),
  ('unit-filter',      1, 'Filter',      'Filters',       'pc',  'count',  0, NULL)
ON CONFLICT (uuid) DO NOTHING;

-- The conversions a lubricant shop actually needs. Seeded rather than derived
-- from litres_each, because a conversion is a business fact: a shop may later
-- define a 55-gallon drum, and litres_each cannot express that.
INSERT INTO unit_conversions (uuid, from_unit_id, to_unit_id, multiplier)
SELECT 'uc-l-ml', a.id, b.id, 1000
  FROM units a, units b WHERE a.uuid = 'unit-litre' AND b.uuid = 'unit-ml'
ON CONFLICT (uuid) DO NOTHING;

INSERT INTO unit_conversions (uuid, from_unit_id, to_unit_id, multiplier)
SELECT 'uc-drum-l', a.id, b.id, 20
  FROM units a, units b WHERE a.uuid = 'unit-litre_drum' AND b.uuid = 'unit-litre'
ON CONFLICT (uuid) DO NOTHING;

INSERT INTO unit_conversions (uuid, from_unit_id, to_unit_id, multiplier)
SELECT 'uc-kg-g', a.id, b.id, 1000
  FROM units a, units b WHERE a.uuid = 'unit-kg' AND b.uuid = 'unit-gram'
ON CONFLICT (uuid) DO NOTHING;

-- Link existing products, matched on the abbreviation already in their packing
-- label. Best-effort by design: a product whose packing is "1pc" maps to piece,
-- "1kg" to kilogram, and anything unrecognised is left NULL rather than
-- guessed at - a wrong unit is worse than no unit, because it looks answered.
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_id INTEGER
  REFERENCES units(id) ON DELETE SET NULL;

UPDATE products p
   SET unit_id = u.id
  FROM units u
 WHERE p.shop_id = 1
   AND p.unit_id IS NULL
   AND (
     (u.uuid = 'unit-litre_drum' AND lower(p.unit) = 'drum')
     OR (u.uuid = 'unit-ml'    AND lower(p.packing) ~ 'ml')
     OR (u.uuid = 'unit-litre' AND lower(p.packing) ~ '(\d)\s*l\b')
     OR (u.uuid = 'unit-kg'    AND lower(p.packing) ~ 'kg')
     OR (u.uuid = 'unit-piece' AND lower(p.unit) = 'piece')
   );

DO $verify$
DECLARE
  dangling  INTEGER;
  self_conv INTEGER;
  bad_dim   INTEGER;
BEGIN
  -- A conversion pointing at a missing unit is a silent divide-by-nothing.
  SELECT count(*) INTO dangling
    FROM unit_conversions c
    LEFT JOIN units f ON f.id = c.from_unit_id
    LEFT JOIN units t ON t.id = c.to_unit_id
   WHERE f.id IS NULL OR t.id IS NULL;
  IF dangling > 0 THEN
    RAISE EXCEPTION '% unit conversion(s) reference a unit that does not exist', dangling;
  END IF;

  SELECT count(*) INTO self_conv FROM unit_conversions WHERE from_unit_id = to_unit_id;
  IF self_conv > 0 THEN
    RAISE EXCEPTION '% unit conversion(s) convert a unit to itself', self_conv;
  END IF;

  -- A volume unit with no litres_each cannot be pro-rated, and working that out
  -- from a string is exactly what this migration exists to stop doing.
  SELECT count(*) INTO bad_dim
    FROM units WHERE dimension = 'volume' AND (litres_each IS NULL OR litres_each <= 0);
  IF bad_dim > 0 THEN
    RAISE EXCEPTION '% volume unit(s) have no litres_each', bad_dim;
  END IF;

  RAISE NOTICE 'units seeded; % product(s) mapped to a unit', (
    SELECT count(*) FROM products WHERE shop_id = 1 AND unit_id IS NOT NULL);
END
$verify$;
