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
  /**
   * Where the stock is (migration 033). NULL means the outlet's default
   * warehouse, resolved in SQL rather than by the caller - so a call site that
   * does not care about warehouses stays correct instead of writing NULL into
   * the column and vanishing from every per-warehouse total.
   */
  warehouseId?: number | null;
  /** Rack/shelf within a warehouse. Optional; a warehouse is enough to count. */
  locationId?: number | null;
}

/**
 * The statements that make a stock change: append the movement, then move the
 * caches. Always used together inside one transaction, so the ledger row and
 * the cached balances can never be committed apart.
 *
 * THREE caches move here, which is a real cost worth stating: products.stock_qty
 * is the total across warehouses, stock_levels is the per-warehouse figure, and
 * they are separate tables that can disagree. Both are derived and both can be
 * rebuilt, and migration 033 refuses to commit while they contradict each other
 * - but two caches over one fact is a genuine trade, not a free win.
 */
export function stockStatements(move: StockMove): StockStatement[] {
  const when = move.occurredAt || new Date().toISOString();
  return [
    {
      // qty_after reads products.stock_qty at insert time and adds the same
      // delta the second statement applies, so the running balance is correct
      // without a second read.
      //
      // warehouse_id falls back to the outlet's default, resolved in the query:
      // a movement with no warehouse would be counted nowhere.
      sql: `INSERT INTO stock_movements
              (uuid, shop_id, item_id, kind, qty, qty_after,
               ref_table, ref_id, warehouse_id, location_id, note, occurred_at)
            SELECT $1, 1, $2, $3, $4,
                   COALESCE(p.stock_qty, 0) + $4,
                   $5, $6,
                   COALESCE($7, (SELECT id FROM warehouses
                                  WHERE shop_id = p.shop_id AND is_default AND active = 1
                                  LIMIT 1)),
                   $8, $9, $10
              FROM products p
             WHERE p.id = $2`,
      params: [
        move.uuid,
        move.itemId,
        move.kind,
        move.qty,
        move.refTable ?? null,
        move.refId ?? null,
        move.warehouseId ?? null,
        move.locationId ?? null,
        move.note ?? "",
        when,
      ],
    },
    {
      sql: "UPDATE products SET stock_qty = COALESCE(stock_qty, 0) + $1 WHERE id = $2",
      params: [move.qty, move.itemId],
    },
    {
      // The per-warehouse cache. On conflict, ADD - so this is correct whether
      // the row exists yet or not, with no separate existence check.
      sql: `INSERT INTO stock_levels (shop_id, warehouse_id, product_id, qty, updated_at)
            SELECT p.shop_id,
                   COALESCE($3, (SELECT id FROM warehouses
                                  WHERE shop_id = p.shop_id AND is_default AND active = 1
                                  LIMIT 1)),
                   p.id, $1, NOW()
              FROM products p
             WHERE p.id = $2
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET qty = stock_levels.qty + $1, updated_at = NOW()`,
      params: [move.qty, move.itemId, move.warehouseId ?? null],
    },
  ];
}

/** Options shared by the stock helpers, so a warehouse can be named where wanted. */
type StockRef = {
  table?: string | null;
  id?: number | null;
  note?: string;
  warehouseId?: number | null;
  locationId?: number | null;
};

/** Stock out — the common case (a sale, a damage write-off). */
export function stockOut(
  itemId: number,
  qty: number,
  kind: StockKind,
  uuid: string,
  ref?: StockRef,
): StockStatement[] {
  return stockStatements({
    itemId,
    kind,
    qty: -Math.abs(qty),
    uuid,
    refTable: ref?.table ?? null,
    refId: ref?.id ?? null,
    note: ref?.note ?? "",
    warehouseId: ref?.warehouseId ?? null,
    locationId: ref?.locationId ?? null,
  });
}

/** Stock in — a purchase, a return, a found item. */
export function stockIn(
  itemId: number,
  qty: number,
  kind: StockKind,
  uuid: string,
  ref?: StockRef,
): StockStatement[] {
  return stockStatements({
    itemId,
    kind,
    qty: Math.abs(qty),
    uuid,
    refTable: ref?.table ?? null,
    refId: ref?.id ?? null,
    note: ref?.note ?? "",
    warehouseId: ref?.warehouseId ?? null,
    locationId: ref?.locationId ?? null,
  });
}

/**
 * Move stock between two warehouses.
 *
 * Two movements that NET TO ZERO, which is the whole point: the product's total
 * does not change, because the stock did not leave the shop - it moved. A
 * transfer that altered the total would be a stock loss recorded as a
 * relocation, and the shelf count would drift on every move.
 *
 * Returned as one flat list to be run in ONE transaction. A transfer that
 * committed only its outgoing half would destroy stock.
 */
export function stockTransfer(
  itemId: number,
  qty: number,
  fromWarehouseId: number,
  toWarehouseId: number,
  ref?: {
    note?: string;
    refTable?: string | null;
    refId?: number | null;
    fromLocationId?: number | null;
    toLocationId?: number | null;
  },
): StockStatement[] {
  const amount = Math.abs(qty);
  const note = ref?.note ?? "Transfer";
  // One suffix shared by both halves, so the pair is identifiable as one event
  // in the ledger. Two unrelated uuids would look like two separate movements.
  const pair = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return [
    ...stockStatements({
      itemId, kind: "transfer_out", qty: -amount, uuid: `tr-out-${pair}`,
      warehouseId: fromWarehouseId, locationId: ref?.fromLocationId ?? null,
      refTable: ref?.refTable ?? null, refId: ref?.refId ?? null,
      note: `${note} (out)`,
    }),
    ...stockStatements({
      itemId, kind: "transfer_in", qty: amount, uuid: `tr-in-${pair}`,
      warehouseId: toWarehouseId, locationId: ref?.toLocationId ?? null,
      refTable: ref?.refTable ?? null, refId: ref?.refId ?? null,
      note: `${note} (in)`,
    }),
  ];
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
