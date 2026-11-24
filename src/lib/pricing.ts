/**
 * Price resolution — the ONE place that decides what an item costs.
 *
 * There used to be two copies of this logic: pf() in POSCart.tsx and
 * getPrice() in POSSearch.tsx, each reading products.price_walking /
 * price_returning / price_wholesale. They had already drifted, which meant the
 * price shown in search results and the price added to the cart could disagree.
 * A price is not something to implement twice.
 *
 * Precedence, most specific first. Each step is "the more personal answer wins",
 * which is how a shop actually thinks about price:
 *
 *   1. party_prices       A customer agreed 3,800 for the GTX. One customer, one
 *                         product, one number - and it beats everything.
 *   2. price_list_items   the price list this customer is assigned to, which
 *                         may carry a quantity break ("10 or more").
 *   3. the legacy columns the three original tiers, unchanged.
 *
 * Step 3 is why this can be shipped to a live shop: the old columns are still
 * there, still correct, and still the answer whenever the new tables have
 * nothing to say. Nothing about today's prices changes on deploy.
 */

export type CustomerType = "walking" | "returning" | "wholesale";

export interface PriceSource {
  /** The list assigned to this customer directly. Individual beats group. */
  priceListId?: number | null;
  /** Rows from price_list_items for that list. */
  listItems?: { product_id: number; price: number | null; min_qty: number | null }[];
  /** Rows from the CUSTOMER'S GROUP's list - the pricing priority layer. */
  groupListItems?: { product_id: number; price: number | null; min_qty: number | null }[];
  /** The tier the customer's group bills at, e.g. 'wholesale'. */
  groupTier?: CustomerType | null;
  /** The rows from party_prices for this customer. */
  partyPrices?: Record<number, number>;
  /** The legacy per-product tier columns, for the fallback. */
  product?: {
    price_walking?: number | null;
    price_returning?: number | null;
    price_wholesale?: number | null;
    wholesale_min_qty?: number | null;
  } | null;
}

export interface ResolvedPrice {
  price: number;
  /** Which rule decided it - shown to the shopkeeper so a surprise is explainable. */
  source: "party" | "assigned_list" | "group_list" | "group_tier" | "tier" | "none";
}

import { packLitres } from "./units.ts";

/**
 * Per-litre unit price for a partial-container (leftover oil) line.
 *
 * A container line bills by the litre drawn, not by the bottle: 0.5L from a
 * 4000/4L bottle is 500, not 4000 (the whole bottle) and not 2000 (half the
 * bottle — 0.5L is the litres left, not half the bottle). addContainer used
 * to charge the full bottle price per litre, which is exactly the error
 * reported 2026-11-24. Pack <= 0 (no volume on the product) falls back to
 * the full price: without a pack there is nothing to pro-rate against.
 */
export function perLitreUnitPrice(pack: number, fullPrice: number): number {
  if (!(pack > 0)) return fullPrice;
  return Math.round((fullPrice / pack) * 100) / 100; // paisa-safe
}

/**
 * The product's OWN tier price for a customer type — the legacy columns only.
 *
 * This is deliberately NOT resolvePrice: resolvePrice's steps 1-2 (an agreed
 * party price, an assigned or group price list) are the "general price" a
 * leftover bottle must never be re-priced at. A leftover is priced from its
 * own brand's pack, so only the product's own columns count here.
 */
export function ownTierPrice(
  p: PriceSource["product"],
  ct: CustomerType,
  qty = 1
): number | null {
  return fromTiers(p, ct, qty);
}

/**
 * What a partial container costs, per litre — from the EXACT bottle it came
 * from, never from the customer in front of the shopkeeper.
 *
 * Reported 2026-11-24, refined the same day: "the price should be taken from
 * the original brand of that bottle, not the general price, it should be
 * considered from the full pack of that exact bottle in the stock or memory."
 *
 * Sources, in order — both are the bottle's OWN price, so a walking customer
 * and a wholesale customer with an agreed party price get the SAME per-litre
 * price for the same bottle, and a different brand's bottle prices differently:
 *
 *   1. The recorded sale (the memory): containers.source_order_id points at
 *      the order that opened this bottle, and the source order_items line for
 *      this product is what that bottle actually cost. When that line was
 *      billed by capacity its unit_price is pro-rated (3500 for 3.5L of a
 *      4L bottle), so the full-pack price is recovered by dividing out the
 *      capacity fraction (3500 / (3.5/4) = 4000) — the pro-rated figure is
 *      never taken as the pack price.
 *   2. The stock record: the product's own tier columns for the customer
 *      type (price_walking / price_returning / price_wholesale) — the
 *      product's own prices, not negotiated ones.
 *
 * If neither source has a price, this THROWS instead of pricing the line at
 * a generic rate: a leftover with no known price must fail visibly (the POS
 * shows the reason and adds nothing) rather than silently giving oil away
 * free or at a guessed price. Callers that only display a price should use
 * containerUnitPriceOrNull.
 *
 * `product` is the product row matched by container.product_id (the caller
 * does the match); the container's recorded line must already be the one for
 * that product — POSSearch's query joins it by (source_order_id, product_id).
 */
export interface ContainerPriceInput {
  product_id: number;
  /** Provenance only — the recorded line below is already matched to it. */
  source_order_id?: number | null;
  /** The source order's recorded line for this product, when it exists. */
  source_unit_price?: number | null;
  source_capacity?: number | null;
  source_billed_by_capacity?: boolean | number | null;
  /** Provenance only — the litres drawn are the cart's qty, not a price. */
  remaining_volume?: number | null;
}

export type ContainerProductPrice = PriceSource["product"] & {
  packing?: string | null;
  name?: string | null;
};

export function containerUnitPrice(
  c: ContainerPriceInput,
  product: ContainerProductPrice | null | undefined,
  ct: CustomerType
): number {
  const pack = packLitres(product);
  if (!(pack > 0)) {
    throw new Error(
      `Cannot price leftover oil: ${product?.name ?? "this product"} has no pack size in litres`
    );
  }
  // 1. The memory — what this exact bottle actually cost in its source sale.
  const recorded = Number(c?.source_unit_price ?? NaN);
  if (Number.isFinite(recorded) && recorded > 0) {
    const cap = Number(c?.source_capacity ?? 0);
    const byCapacity =
      c?.source_billed_by_capacity === true || c?.source_billed_by_capacity === 1;
    const fullPack =
      byCapacity && cap > 0 && cap < pack ? (recorded * pack) / cap : recorded;
    if (fullPack > 0) return perLitreUnitPrice(pack, fullPack);
  }
  // 2. The stock record — the product's own tier price for this customer type.
  // Party prices and price lists are deliberately NOT consulted here.
  const tier = ownTierPrice(product, ct, 1);
  if (tier !== null && tier > 0) return perLitreUnitPrice(pack, tier);
  throw new Error(
    `Cannot price leftover oil: no recorded sale price and no own price for ${product?.name ?? "this product"}`
  );
}

/** containerUnitPrice, but null instead of a throw — for search display only. */
export function containerUnitPriceOrNull(
  c: ContainerPriceInput,
  product: ContainerProductPrice | null | undefined,
  ct: CustomerType
): number | null {
  try {
    return containerUnitPrice(c, product, ct);
  } catch {
    return null;
  }
}

/**
 * Best price for a product from a list, honouring quantity breaks.
 *
 * The best match is the highest min_qty the quantity actually reaches. Falling
 * back to the largest break that was NOT reached would price a single unit at
 * the bulk rate, which is the classic way this rule gets implemented wrong.
 */
function bestFromList(
  items: PriceSource["listItems"],
  productId: number,
  qty: number
): number | null {
  if (!items?.length) return null;
  // min_qty is normalised to a number immediately, so the comparison is never
  // against null even though the column is nullable.
  let best: { price: number; minQty: number } | null = null;
  for (const it of items) {
    if (it.product_id !== productId) continue;
    if (it.price === null || it.price === undefined) continue;
    const minQty = it.min_qty === null || it.min_qty === undefined ? 0 : Number(it.min_qty);
    if (qty < minQty) continue;
    if (!best || minQty > best.minQty) best = { price: Number(it.price), minQty };
  }
  return best ? best.price : null;
}

/** The legacy three-tier rule, extracted so the group can reuse it. */
function fromTiers(p: PriceSource["product"], tier: CustomerType, qty: number): number | null {
  if (!p) return null;
  if (tier === "walking") {
    if (p.price_walking !== null && p.price_walking !== undefined) return Number(p.price_walking);
  } else if (tier === "wholesale") {
    const minQty = Number(p.wholesale_min_qty ?? 0);
    if (p.price_wholesale && qty >= minQty) return Number(p.price_wholesale);
  }
  if (p.price_returning !== null && p.price_returning !== undefined) return Number(p.price_returning);
  return null;
}

export function resolvePrice(
  productId: number,
  customerType: CustomerType,
  qty: number,
  src: PriceSource
): ResolvedPrice {
  // 1. An individually agreed price, which is specific to the customer and
  //    deliberately not quantity-dependent.
  const agreed = src.partyPrices?.[productId];
  if (agreed !== undefined && agreed !== null) return { price: Number(agreed), source: "party" };

  // 2. A list assigned to this customer directly. Individual beats group: a one
  //    off arrangement is more personal than the group rule it sits inside.
  const assigned = bestFromList(src.listItems, productId, qty);
  if (assigned !== null) return { price: assigned, source: "assigned_list" };

  // 3. The GROUP's list - "returning, wholesale or walking, as priority on top
  //    of normal price". This is the layer the shopkeeper asked for.
  const grouped = bestFromList(src.groupListItems, productId, qty);
  if (grouped !== null) return { price: grouped, source: "group_list" };

  // 4. The group's tier via the product's own tier columns, for a group with no
  //    dedicated list - which is the common case, and keeps one price per
  //    product instead of copying it into every group.
  if (src.groupTier) {
    const byGroup = fromTiers(src.product, src.groupTier, qty);
    if (byGroup !== null) return { price: byGroup, source: "group_tier" };
  }

  // 5. The manual W / R / Wh switcher. Kept for walk-ins and one-off bills, and
  //    as the fallback for a customer whose group is unset.
  const bySwitch = fromTiers(src.product, customerType, qty);
  if (bySwitch !== null) return { price: bySwitch, source: "tier" };

  return { price: 0, source: "none" };
}

/**
 * One query that returns every price that applies to a customer, for a set of
 * products — so the cart can price a whole bill without a round trip per line.
 *
 * The `DISTINCT ON` would be the tidy way to do this, but the app also runs
 * against SQLite through pgToSqlite, which does not support it. Window
 * functions work on both, so the same SQL serves the cloud and the desktop.
 */
export const PRICE_CONTEXT_SQL = `
  WITH party AS (
    SELECT pll.price_list_id
      FROM party_price_lists pll
     WHERE pll.party_type = 'customer' AND pll.party_id = $1
  )
  SELECT
    pp.product_id,
    pp.price AS party_price,
    pli.price AS list_price,
    pli.min_qty,
    pl.id AS list_id,
    pl.markup_pct,
    pl.rounding_mode,
    pl.rounding_value
  FROM party_price_lists pll
  JOIN party ON party.price_list_id = pll.price_list_id
  JOIN price_lists pl   ON pl.id = pll.price_list_id
  LEFT JOIN price_list_items pli ON pli.price_list_id = pl.id
  LEFT JOIN party_prices pp      ON pp.party_type = 'customer'
                               AND pp.party_id = $1
                               AND pp.product_id = pli.product_id
  WHERE pll.party_type = 'customer' AND pll.party_id = $1`;
