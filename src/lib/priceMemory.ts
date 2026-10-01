/**
 * Party-wise price memory — "what did I last charge THIS customer for THIS
 * product", and for how many litres.
 *
 * Deliberately pure: no database, no React, no imports. The SQL lives in the
 * caller and this module only shapes the rows it gets back, which is what makes
 * the interesting parts testable without a browser (see
 * server/unit_price_memory.mjs). The rules that matter:
 *
 * - Memory is per CUSTOMER. A walking customer with no customer row has no
 *   memory, and a product's list price is not offered as a substitute: a price
 *   someone else paid is a different deal.
 * - Memory is per LITRE. A 3.5L fill and a full 4L bottle are different sales at
 *   different prices, so once the cashier enters a capacity, only what was sold
 *   at that fill size is a fair comparison. With no capacity entered, the most
 *   recent entry is shown with its own litre value instead of being hidden.
 * - Voided bills do not count. voidOrder() keeps the row as 'cancelled' for the
 *   audit trail, so the query must filter; a price from a cancelled bill is not
 *   a price that happened.
 */

/** One past sale, as the price-memory query returns it. */
export interface PriceMemoryRow {
  ref_id: number;
  product_name: string;
  unit_price: number;
  qty: number;
  /** Litres the engine actually took. 0 means the whole bottle was sold. */
  capacity: number | null;
  /**
   * BOOLEAN in Postgres, 0/1 in the local SQLite replica — the same column, two
   * representations, so the type admits both.
   */
  billed_by_capacity: boolean | number | null;
  order_id: number;
  created_at: string;
}

/** A past sale, resolved and ready to render. */
export interface PriceMemory {
  refId: number;
  productName: string;
  unitPrice: number;
  qty: number;
  /** Litres actually taken, resolved to the pack size when nothing was recorded. */
  litres: number;
  /** True when the billed price was a fraction of the bottle (capacity billing). */
  prorated: boolean;
  orderId: number;
  at: string;
}
export interface PriceMemoryOptions {
  /**
   * Litres the cashier is about to bill for each product, keyed by product id.
   * Only entries matching that fill size are returned for those products.
   */
  wantedLitres?: Record<number, number>;
  /** Pack size per product, used when a past sale recorded no capacity. */
  packLitres?: Record<number, number>;
  /** How many past sales to keep per product. */
  limit?: number;
}

/** 3.5 and 3.50 are the same fill; 3.5 and 3.7 are not. */
const LITRE_TOLERANCE = 0.05;

function sameFill(a: number, b: number): boolean {
  return Math.abs(a - b) < LITRE_TOLERANCE;
}

/** The SQL the caller runs. Exported so the test and the screen cannot diverge. */
export const PRICE_MEMORY_SQL = (customerId: number, productCount: number): string => {
  // A portable IN list rather than `= ANY($2)`: pgToSqlite does not translate
  // ANY, so the array form would work in the browser and break offline.
  const inList = Array.from({ length: Math.max(productCount, 1) }, (_, i) => `$${i + 2}`).join(", ");
  return `SELECT oi.ref_id, oi.product_name, oi.unit_price, oi.qty,
                oi.capacity, oi.billed_by_capacity,
                o.id AS order_id, o.created_at
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE o.customer_id = $1
            AND o.status = 'completed'
            AND oi.kind = 'product'
            AND oi.ref_id IN (${inList})
          ORDER BY oi.ref_id, o.created_at DESC, oi.id DESC`;
};

export function buildPriceMemory(
  rows: PriceMemoryRow[],
  options: PriceMemoryOptions = {},
): Map<number, PriceMemory[]> {
  const { wantedLitres = {}, packLitres = {}, limit = 2 } = options;
  const out = new Map<number, PriceMemory[]>();

  // Sort defensively rather than trusting the caller. The query orders by
  // created_at DESC, but relying on that is an unstated precondition: rows
  // arriving in any other order silently produced the OLDEST prices labelled as
  // "last", which is worse than showing nothing. Newest first, ties broken by
  // the higher order id.
  const ordered = [...(rows ?? [])].sort((a, b) => {
    const at = String(a?.created_at ?? "");
    const bt = String(b?.created_at ?? "");
    if (at !== bt) return at < bt ? 1 : -1;
    return Number(b?.order_id ?? 0) - Number(a?.order_id ?? 0);
  });

  for (const r of ordered) {
    const refId = Number(r?.ref_id);
    if (!Number.isFinite(refId)) continue;

    const taken = Number(r.capacity ?? 0);
    const pack = Number(packLitres[refId] ?? 0);
    // "Litres taken" is the engine capacity when one was recorded, otherwise
    // the whole bottle. A 4L engine on a 4L bottle has nothing left over and
    // still counts as 4 litres taken.
    const litres = taken > 0 ? taken : pack > 0 ? pack : 0;
    // billed_by_capacity is a BOOLEAN in Postgres and a 0/1 integer in the
    // local SQLite replica, so this has to accept either rather than trust one
    // engine's representation.
    const prorated =
      r.billed_by_capacity === true || Number(r.billed_by_capacity) === 1;

    const wanted = Number(wantedLitres[refId] ?? 0);
    // A capacity the cashier has entered narrows the memory to that fill size.
    // No capacity entered means "just show me what happened", so nothing is
    // filtered out.
    if (wanted > 0 && !(litres > 0 && sameFill(litres, wanted))) continue;

    const entry: PriceMemory = {
      refId,
      productName: String(r.product_name ?? ""),
      unitPrice: Number(r.unit_price ?? 0),
      qty: Number(r.qty ?? 0),
      litres,
      prorated,
      orderId: Number(r.order_id ?? 0),
      at: String(r.created_at ?? ""),
    };

    const list = out.get(refId);
    if (list) {
      if (list.length < limit) list.push(entry);
    } else {
      out.set(refId, [entry]);
    }
  }
  return out;
}

/** "3.5L · Rs 3,500 · 30 Sep" — one line, meant to be read without focusing. */
export function formatMemoryLine(m: PriceMemory, currency: (n: number) => string): string {
  const litres = m.litres > 0 ? `${trimNumber(m.litres)}L` : "full";
  const qty = m.qty > 1 ? ` ×${trimNumber(m.qty)}` : "";
  const when = m.at ? ` · ${m.at.slice(0, 10)}` : "";
  return `${litres} · ${currency(m.unitPrice)}${qty}${when}`;
}

/** 3.50 -> "3.5", 4 -> "4". Prices are typed by hand, so trailing zeros are noise. */
export function trimNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Bills before we suggest promoting a walking customer to a returning one. */
export const WALKING_PROMOTION_THRESHOLD = 3;