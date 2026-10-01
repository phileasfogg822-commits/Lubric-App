-- 031_customer_groups.sql — grouping as a pricing priority, and credit with it.
--
-- The shopkeeper's own words: "the returning, wholesale or walkin, pricing
-- should follow this as priority on top of normal price". So a group is not a
-- label on a customer - it is a LAYER that decides the price, sitting above the
-- product's normal price and below a price agreed with one named customer:
--
--   1. party_prices    Zafar agreed 3,800 for the GTX   (most specific)
--   2. GROUP           his group: wholesale / returning / walking
--   3. price list      assigned directly, or the group's own list
--   4. base price      products.price_returning         (normal price)
--
-- This also fixes a regression introduced when price lists were wired into the
-- POS. Every customer was backfilled onto a price list, and resolvePrice
-- returns the list before it ever looks at the tier - so the W / R / Wh buttons
-- silently stopped doing anything for all four customers. The tier was never
-- dead code; it was the missing priority layer, and the group is where it lives.
--
-- ── Why credit lives on the group ───────────────────────────────────────────
-- "Fleet pays in 30 days" is a property of the FLEET, not of one customer, and
-- the same customer in a different group would get different terms. Putting
-- credit_days beside the pricing rule means one place answers both "what does
-- this customer pay" and "how long may they take to pay", so they cannot drift
-- apart the way a separate credit field would.
--
-- Fully idempotent.

CREATE TABLE IF NOT EXISTS customer_groups (
  id             SERIAL PRIMARY KEY,
  uuid           TEXT UNIQUE NOT NULL,
  shop_id        INTEGER NOT NULL REFERENCES shops(id),
  name           TEXT NOT NULL,
  code           TEXT,
  -- The pricing rule this group bills at. Drives resolvePrice's second step.
  price_tier     TEXT NOT NULL DEFAULT 'returning'
                 CHECK (price_tier IN ('walking', 'returning', 'wholesale')),
  -- Optional dedicated list. NULL means the group is priced by price_tier alone,
  -- which is the common case and keeps the normal price in one place.
  price_list_id  INTEGER REFERENCES price_lists(id),
  -- 0 means cash only: no customer may buy on credit.
  credit_days    INTEGER NOT NULL DEFAULT 0 CHECK (credit_days >= 0),
  -- 0 means no ceiling. Checked, never enforced by the database: blocking a
  -- sale is a decision for the person at the till, not a constraint.
  credit_limit   NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  colour         TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_groups_shop ON customer_groups (shop_id, active);

-- One group per customer. A UNIQUE on customers.group_id is NOT used, because
-- the index that matters is on customers and the membership table below is what
-- allows history later; a customer having exactly one group is enforced by
-- making group_id a single column, not by a second table.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS group_id INTEGER
  REFERENCES customer_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_group ON customers (group_id);

-- ── the three groups the shop already trades with ──────────────────────────
-- Named from the three price tiers that already exist, so this changes no
-- price: a customer who was 'walking' is in the Walking group and is billed
-- exactly what the Walking list always said.
INSERT INTO customer_groups (uuid, shop_id, name, code, price_tier, price_list_id, active) VALUES
  ('cg-walking',   1, 'Walking',   'WALKING',   'walking',   NULL, 1),
  ('cg-returning', 1, 'Returning', 'RETURNING', 'returning', NULL, 1),
  ('cg-wholesale', 1, 'Wholesale', 'WHOLESALE', 'wholesale', NULL, 1)
ON CONFLICT (uuid) DO NOTHING;

-- The group carries the list, and the per-customer row that migration 028
-- backfilled is then redundant: same list, reached via the group instead of
-- repeated per customer. Removing them is the point of grouping - twenty fleet
-- customers on the Fleet list should be one fact, not twenty.
--
-- lower() is load-bearing: the group codes are WALKING / RETURNING / WHOLESALE
-- (readable in a dropdown) while the list uuids are pl-walking / pl-returning /
-- pl-wholesale. A first version built the uuid as 'pl-' || ltrim(g.code) without
-- it, matched nothing, and left every group with a NULL list - which the verify
-- block below did not catch, because a NULL join produces no rows to complain
-- about. Both halves are fixed: the join, and the check that would have caught it.
UPDATE customer_groups g
   SET price_list_id = l.id
  FROM price_lists l
 WHERE lower(ltrim(g.code)) = ltrim(l.uuid, 'pl-')
   AND g.price_list_id IS NULL;

-- Every existing customer joins the group their customer_type already implied.
UPDATE customers c
   SET group_id = g.id
  FROM customer_groups g
 WHERE c.shop_id = 1
   AND c.group_id IS NULL
   AND g.shop_id = 1
   AND g.code = CASE c.customer_type
                  WHEN 'walking'   THEN 'WALKING'
                  WHEN 'wholesale' THEN 'WHOLESALE'
                  ELSE 'RETURNING'
                END;

DO $verify$
DECLARE
  ungrouped  INTEGER;
  bad_links  INTEGER;
  mismatched INTEGER;
BEGIN
  SELECT count(*) INTO ungrouped
    FROM customers WHERE shop_id = 1 AND group_id IS NULL;
  IF ungrouped > 0 THEN
    RAISE EXCEPTION '% customer(s) are in no group and would fall back to base price', ungrouped;
  END IF;

  -- A group whose list is not its own tier's list would bill a wholesale
  -- customer off the retail list - the exact confusion this feature must not
  -- introduce.
  SELECT count(*) INTO mismatched
    FROM customer_groups g
    JOIN price_lists l ON l.id = g.price_list_id
   WHERE l.code <> g.code;
  IF mismatched > 0 THEN
    RAISE EXCEPTION '% group(s) point at a list belonging to a different tier', mismatched;
  END IF;

  -- Every group MUST reach a list, or it falls back to the product's tier columns
  -- and the group layer silently does nothing. This is the check that would have
  -- caught a NULL price_list_id: a LEFT JOIN yields no rows, so the mismatch
  -- count above reads 0 and looks healthy.
  SELECT count(*) INTO ungrouped
    FROM customer_groups
   WHERE shop_id = 1 AND active = 1 AND price_list_id IS NULL;
  IF ungrouped > 0 THEN
    RAISE EXCEPTION
      '% group(s) have no price list and would price by tier columns only', ungrouped;
  END IF;

  RAISE NOTICE 'groups assigned to every customer; lists present and matching tiers';
END
$verify$;