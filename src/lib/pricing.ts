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
 *   1. party_prices       Zafar agreed 3,800 for the GTX. One customer, one
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
  /** The customer's assigned list, if any. */
  priceListId?: number | null;
  /** The rows from price_list_items for that list. */
  listItems?: { product_id: number; price: number | null; min_qty: number | null }[];
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
  source: "party" | "list" | "tier" | "none";
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

  // 2. The customer's price list, quantity break honoured.
  //
  //    The best match is the highest min_qty the quantity actually reaches, so
  //    buying 12 of something priced "10 or more" gets the bulk price, and
  //    buying 9 gets the list price. Falling back to the highest break that was
  //    NOT reached would price a single unit at the bulk rate, which is the
  //    classic way this rule gets implemented wrong.
  if (src.listItems?.length) {
    // min_qty is normalised to a number immediately, so the comparison below is
    // never against null even though the column is nullable.
    let best: { price: number; minQty: number } | null = null;
    for (const it of src.listItems) {
      if (it.product_id !== productId) continue;
      if (it.price === null || it.price === undefined) continue;
      const minQty = it.min_qty === null || it.min_qty === undefined ? 0 : Number(it.min_qty);
      if (qty < minQty) continue;
      if (!best || minQty > best.minQty) best = { price: Number(it.price), minQty };
    }
    if (best) return { price: best.price, source: "list" };
  }

  // 3. The three original tiers, exactly as pf() and getPrice() did them.
  const p = src.product;
  if (p) {
    if (customerType === "walking") {
      if (p.price_walking !== null && p.price_walking !== undefined) {
        return { price: Number(p.price_walking), source: "tier" };
      }
    } else if (customerType === "wholesale") {
      const minQty = Number(p.wholesale_min_qty ?? 0);
      if (p.price_wholesale && qty >= minQty) return { price: Number(p.price_wholesale), source: "tier" };
    }
    if (p.price_returning !== null && p.price_returning !== undefined) {
      return { price: Number(p.price_returning), source: "tier" };
    }
  }

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
