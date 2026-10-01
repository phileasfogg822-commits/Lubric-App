/**
 * The stock ledger — the one place stock is allowed to change.
 *
 * Spec §180: "Do not rely only on item.quantity. Maintain stock movements."
 * Every caller used to run its own `UPDATE products SET stock_qty = ...`, which
 * left a number no one could audit and no way to answer "why is this 20?".
 * Three scattered call sites, three ways to get it wrong.
 *
 * The model is the standard one, and the reason it is trustworthy:
 *
 *   stock_movements   append-only. Never updated, never deleted.
 *   products.stock_qty a CACHE of SUM(qty) per item.
 *   rebuild_stock()   recomputes the cache from the ledger.
 *
 * Because the cache can always be derived from the ledger, the two can never
 * silently disagree for long — `reconcileStock()` reports any item where they
 * do. Without that, a cache is just a second source of truth with a slower
 * update path.
 *
 * The quantity is SIGNED: positive adds stock, negative removes it, so the
 * balance is a plain SUM() rather than a direction column the maths has to
 * interpret.
 *
 * `qty_after` is denormalised on purpose. "What did we have after that?" is the
 * question a shopkeeper actually asks while looking at a movement, and
 * recomputing it per row would mean a correlated subquery on every read.
 *
 * SQL is written to survive pgToSqlite: no gen_random_uuid (the caller supplies
 * the id, as it does everywhere else), no ::timestamptz casts (the translator
 * mangles that one), no FILTER, no RETURNING.
 */

export const STOCK_KINDS = [
  "opening",
  "purchase",
  "sale",
  "sale_return",
  "purchase_return",
  "adjustment",
  "transfer_in",
  "transfer_out",
  "damage",
  "found",
  "count_correction",
] as const;

export type StockKind = (typeof STOCK_KINDS)[number];

/** Reasons a physical count disagrees with the books, per spec §36. */
export const COUNT_REASONS: { key: string; label: string; delta: "in" | "out" | "both" }[] = [
  { key: "damage", label: "Damaged", delta: "out" },
  { key: "expired", label: "Expired", delta: "out" },
  { key: "lost", label: "Lost / stolen", delta: "out" },
  { key: "found", label: "Found", delta: "in" },
  { key: "count_correction", label: "Manual correction", delta: "both" },
];

export interface StockStatement {
  sql: string;
  params: unknown[];
}

export interface StockMove {
  itemId: number;
  kind: StockKind;
  /** Signed: positive adds, negative removes. */
  qty: number;
  /** Client-generated so the row replicates and a retry cannot double-post. */
  uuid: string;
  refTable?: string | null;
  refId?: number | null;
  note?: string;
  occurredAt?: string;
}

/**
 * The two statements that make a stock change: append the movement, then move
 * the cache. Always used together inside one transaction, so the ledger row and
 * the cached balance can never be committed apart.
 */
export function stockStatements(move: StockMove): StockStatement[] {
  const when = move.occurredAt || new Date().toISOString();
  return [
    {
      // qty_after reads products.stock_qty at insert time and adds the same
      // delta the second statement applies, so the running balance is correct
      // without a second read.
      sql: `INSERT INTO stock_movements
              (uuid, shop_id, item_id, kind, qty, qty_after,
               ref_table, ref_id, note, occurred_at)
            SELECT $1, 1, $2, $3, $4,
                   COALESCE(p.stock_qty, 0) + $4,
                   $5, $6, $7, $8
              FROM products p
             WHERE p.id = $2`,
      params: [
        move.uuid,
        move.itemId,
        move.kind,
        move.qty,
        move.refTable ?? null,
        move.refId ?? null,
        move.note ?? "",
        when,
      ],
    },
    {
      sql: "UPDATE products SET stock_qty = COALESCE(stock_qty, 0) + $1 WHERE id = $2",
      params: [move.qty, move.itemId],
    },
  ];
}

/** Stock out — the common case (a sale, a damage write-off). */
export function stockOut(
  itemId: number,
  qty: number,
  kind: StockKind,
  uuid: string,
  ref?: { table?: string | null; id?: number | null; note?: string },
): StockStatement[] {
  return stockStatements({
    itemId,
    kind,
    qty: -Math.abs(qty),
    uuid,
    refTable: ref?.table ?? null,
    refId: ref?.id ?? null,
    note: ref?.note ?? "",
  });
}

/** Stock in — a purchase, a return, a found item. */
export function stockIn(
  itemId: number,
  qty: number,
  kind: StockKind,
  uuid: string,
  ref?: { table?: string | null; id?: number | null; note?: string },
): StockStatement[] {
  return stockStatements({
    itemId,
    kind,
    qty: Math.abs(qty),
    uuid,
    refTable: ref?.table ?? null,
    refId: ref?.id ?? null,
    note: ref?.note ?? "",
  });
}

/** One row of the item's stock history, newest first, with the running balance. */
export const STOCK_HISTORY_SQL = `
  SELECT m.id, m.uuid, m.kind, m.qty, m.qty_after, m.ref_table, m.ref_id,
         m.note, m.occurred_at, p.name AS item_name
    FROM stock_movements m
    JOIN products p ON p.id = m.item_id
   WHERE m.item_id = $1
   ORDER BY m.occurred_at DESC, m.id DESC
   LIMIT 200`;

/** Every item where the cache and the ledger disagree. Empty means healthy. */
export const STOCK_RECONCILE_SQL = `
  SELECT r.item_id, r.ledger_qty, r.cached_qty, r.fixed
    FROM rebuild_stock(1) r
   WHERE r.fixed <> 0
   ORDER BY ABS(r.fixed) DESC`;
