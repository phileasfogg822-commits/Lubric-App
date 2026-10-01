-- 028_price_lists.sql — pricing you can extend, not three hardcoded columns.
--
-- Spec §25 lists `unit`, §27 `price_list`, §216 `price_list_item`,
-- §220 `party_price` as Phase 2 master data. None exist.
--
-- What exists instead: products carry price_walking, price_returning and
-- price_wholesale, and the customer carries a customer_type that picks one of
-- the three. Those tiers are not configurable, not per-customer, and a fourth
-- tier is a schema change. Worse, the tier rules are written TWICE - pf() in
-- POSCart.tsx and getPrice() in POSSearch.tsx - so the search result and the
-- cart can disagree about what an item costs.
--
-- This adds the real model WITHOUT changing today's behaviour: price lists,
-- their items, a party's list, and a per-party override. Then it backfills the
-- three existing tiers into three real price lists and assigns every customer
-- to the list their customer_type already implied. So the migration is
-- behaviour-preserving today and the columns stay as the fallback underneath,
-- which is what makes it safe to ship to a live shop.
--
-- Precedence once wired up, most specific first:
--   1. party_prices        - this customer's agreed price for this product
--   2. price_list_items    - the list their party is assigned
--   3. the legacy columns  - unchanged fallback
--
-- Fully idempotent.

CREATE TABLE IF NOT EXISTS price_lists (
  id         SERIAL PRIMARY KEY,
  uuid       TEXT UNIQUE NOT NULL,
  shop_id    INTEGER NOT NULL REFERENCES shops(id),
  name       TEXT NOT NULL,
  code       TEXT,
  -- Only one list can be the default a party gets when none is assigned.
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  -- Marked up or marked down from the base price, applied when an item has no
  -- explicit price. Rounding is how a shop keeps prices ending in 0 or 50
  -- without retyping every one of them.
  markup_pct NUMERIC(9,4) NOT NULL DEFAULT 0,
  rounding_mode  TEXT NOT NULL DEFAULT 'none'
                CHECK (rounding_mode IN ('none','nearest','up','down')),
  rounding_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_lists_shop ON price_lists (shop_id, active);

CREATE TABLE IF NOT EXISTS price_list_items (
  id            SERIAL PRIMARY KEY,
  price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price         NUMERIC(18,4),
  -- NULL means the list price applies at any quantity; a number means the
  -- wholesale-style "10 or more" rule that products.wholesale_min_qty already
  -- does for one specific case.
  min_qty       NUMERIC(18,3),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pli_price_positive CHECK (price IS NULL OR price >= 0)
);
-- NULLS NOT DISTINCT, so a list cannot hold two "any quantity" rows for the
-- same product - which would make resolution depend on row order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pli_unique
  ON price_list_items (price_list_id, product_id, min_qty) NULLS NOT DISTINCT;

-- Which list a customer or supplier buys at.
CREATE TABLE IF NOT EXISTS party_price_lists (
  id            SERIAL PRIMARY KEY,
  shop_id       INTEGER NOT NULL REFERENCES shops(id),
  party_type    TEXT NOT NULL CHECK (party_type IN ('customer','vendor')),
  party_id      INTEGER NOT NULL,
  price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ppl_unique ON party_price_lists (party_type, party_id);

-- An individually agreed price, which beats the list. This is what a shop means
-- by "Zafar gets 3,800 for the GTX" - one customer, one product, one number.
CREATE TABLE IF NOT EXISTS party_prices (
  id         SERIAL PRIMARY KEY,
  shop_id    INTEGER NOT NULL REFERENCES shops(id),
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','vendor')),
  party_id   INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price      NUMERIC(18,4) NOT NULL,
  note       TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pp_price_positive CHECK (price >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_party_prices_unique
  ON party_prices (party_type, party_id, product_id);

-- ── backfill: today's three tiers become three real price lists ─────────────
-- The point of doing this rather than leaving the columns to be migrated later
-- is that nothing changes for the shop on deploy: a customer who was 'walking'
-- is on the Walking list, and resolves to the same number they always did. The
-- columns stay in place underneath as the fallback, so this can be introduced
-- without a flag day.
INSERT INTO price_lists (uuid, shop_id, name, code, is_default, active) VALUES
  ('pl-walking',   1, 'Walking Customer',   'WALKING',  TRUE,  1),
  ('pl-returning', 1, 'Returning Customer', 'RETURNING', FALSE, 1),
  ('pl-wholesale', 1, 'Wholesale',          'WHOLESALE', FALSE, 1)
ON CONFLICT (uuid) DO NOTHING;

-- Each tier column becomes that list's price for every product that has one.
INSERT INTO price_list_items (price_list_id, product_id, price, min_qty)
SELECT l.id, p.id, p.price_returning, NULL
  FROM price_lists l CROSS JOIN products p
 WHERE l.uuid = 'pl-returning' AND COALESCE(p.price_returning, 0) > 0
ON CONFLICT DO NOTHING;

INSERT INTO price_list_items (price_list_id, product_id, price, min_qty)
SELECT l.id, p.id, p.price_walking, NULL
  FROM price_lists l CROSS JOIN products p
 WHERE l.uuid = 'pl-walking' AND p.price_walking IS NOT NULL AND p.price_walking > 0
ON CONFLICT DO NOTHING;

-- Wholesale keeps its quantity rule, which is why min_qty exists at all: the
-- list price applies only at or above the product's own threshold.
INSERT INTO price_list_items (price_list_id, product_id, price, min_qty)
SELECT l.id, p.id, p.price_wholesale, p.wholesale_min_qty
  FROM price_lists l CROSS JOIN products p
 WHERE l.uuid = 'pl-wholesale' AND COALESCE(p.price_wholesale, 0) > 0
ON CONFLICT DO NOTHING;

-- Every existing customer is put on the list their customer_type already chose,
-- so the POS resolves them through the new model and gets the same answer.
INSERT INTO party_price_lists (shop_id, party_type, party_id, price_list_id)
SELECT 1, 'customer', c.id, l.id
  FROM customers c
  JOIN price_lists l
    ON l.uuid = CASE c.customer_type
                  WHEN 'walking'   THEN 'pl-walking'
                  WHEN 'wholesale' THEN 'pl-wholesale'
                  ELSE 'pl-returning'
                END
 WHERE c.shop_id = 1
ON CONFLICT (party_type, party_id) DO NOTHING;
