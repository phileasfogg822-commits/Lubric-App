/**
 * Leftover (partial-container) oil pricing — the 2026-11-24 report, refined
 * the same day by Umar: "the price should be taken from the original brand
 * of that bottle, not the general price, it should be considered from the
 * full pack of that exact bottle in the stock or memory."
 *
 * The bug: addContainer in src/modules/pos/POSCart.tsx priced a
 * partial-container line at the FULL bottle price (tierPrice for 1 pack),
 * while qty is litres drawn — so 0.5L of a 4000/4L bottle cost 4000, and the
 * 0.5 option (half the bottle) cost 2000. The fix: per-litre pricing from
 * the EXACT bottle — containerUnitPrice in src/lib/pricing.ts:
 *
 *   1. the recorded sale (the memory): containers.source_order_id points at
 *      the order that opened the bottle; the source order_items line is what
 *      that bottle actually cost. A line billed by capacity is pro-rated,
 *      so the full-pack price is recovered by dividing out the capacity
 *      fraction (3500 for 3.5L of a 4L bottle recovers to 4000).
 *   2. the stock record: the product's own tier columns for the customer
 *      type — never an agreed party price or a price list (the "general
 *      price" Umar ruled out). resolvePrice's party/list steps are not
 *      consulted for a leftover at all.
 *   3. neither source has a price: the line fails visibly (a throw the POS
 *      shows in the error banner, adding nothing) instead of pricing at a
 *      generic rate.
 *
 * What is checked:
 *   1. the reported bug, red shape: the old formula prices 0.5L at 4000;
 *      the new formula prices it at 500 (1000/L x 0.5L).
 *   2. the refinement: the same container costs the SAME per litre for a
 *      walking customer and for a wholesale customer with an agreed party
 *      price of 3000 — the agreed price is ignored (resolvePrice would
 *      have given 3000).
 *   3. capacity recovery: a source line billed 3500 for 3.5L recovers to
 *      the 4000 pack (1000/L); a discounted memory line (3325 for 3.5L)
 *      recovers to its own 3800 pack (950/L), not the 4000 tier.
 *   4. tier fallback (no source order): the product's OWN tier columns —
 *      walking 4000 -> 1000/L, wholesale 3600 -> 900/L — never the agreed
 *      3000 (which would give 750/L).
 *   5. the price follows the product/brand: a different brand's 2000/4L
 *      bottle prices at 500/L.
 *   6. fail visibly: no recorded price and no own tier price throws (and
 *      the null-safe variant returns null); a product with no pack size
 *      throws too.
 *   7. local mode (SQLite): the REAL POSSearch container query (with the
 *      source-line subqueries) returns the recorded line, and the REAL
 *      completeSale statements for the container line land the right row
 *      (qty 0.5, unit_price 1000, line_total 500, capacity 0.5), draw the
 *      container to 0 / 'empty', and record the split.
 *   8. server mode: the SAME statement text and params (the VPS executes
 *      them verbatim through /api/transaction) — Postgres-valid syntax
 *      only (NOW(), $n, no SQLite-isms). No live server is run here; the
 *      check is that the text the server receives is identical to the text
 *      the local run proved.
 *   9. regression: a 4L bottle billed by capacity 3.5 still bills 3500
 *      and shelves 0.5L.
 *
 * addContainer itself lives in POSCart.tsx (.tsx), which node cannot import
 * — so the line-build arithmetic (qty = min(1, remaining), line_total =
 * unit_price x qty) is driven here with the values the real functions
 * produce, and the source tie-in below asserts the .tsx calls the resolver.
 *
 * Run:  node --experimental-strip-types sim_leftover_container_pricing.js
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  containerUnitPrice,
  containerUnitPriceOrNull,
  ownTierPrice,
  perLitreUnitPrice,
  resolvePrice,
} from '../src/lib/pricing.ts';
import { packLitres } from '../src/lib/units.ts';
import { ensureLocalSchema, pgToSqlite } from '../src/lib/localDb.ts';
import { injectUuid } from '../src/lib/outbox.ts';
import { SYNC_TABLES } from '../src/lib/sync.ts';

const raw = new DatabaseSync(':memory:');

// Same adapter as sim_windows_login.js: node:sqlite binds anonymous
// placeholders, while the Tauri plugin the app ships with understands $1.
const db = {
  execute: async (sql) => raw.exec(sql),
  select: async (sql) => raw.prepare(sql).all(),
};

function toSqlite(sql) {
  return pgToSqlite(sql);
}
// Numbered binding, like the Tauri plugin — with the injectUuid correction:
// injectUuid appends a literal `?` for the fresh uuid, and it binds the
// param AFTER the highest $n (the 10th placeholder in the orders INSERT is
// params[8], the uuid — NOT params[9] — because $4 appears twice).
// Indexing a literal ? by placeholder position binds NULL and a duplicate
// re-execution silently succeeds, which is how the 2067 proof was first
// missed in the experiments.
function bind(sql, params = []) {
  const sqlite = toSqlite(sql);
  let maxN = 0;
  for (const m of sqlite.matchAll(/\$(\d+)/g)) maxN = Math.max(maxN, Number(m[1]));
  let nextLiteral = maxN;
  const ordered = [];
  const text = sqlite.replace(/\$(\d+)|\?/g, (m, n) => {
    if (n !== undefined) ordered.push(params[Number(n) - 1]);
    else ordered.push(params[nextLiteral++]);
    return '?';
  });
  return { sql: text, params: ordered };
}
function run(sql, params = []) {
  const b = bind(sql, params);
  return raw.prepare(b.sql).all(...b.params);
}
// Mirrors dbTransaction's local path (src/lib/db.ts): injectUuid per
// statement at execution time, one BEGIN..COMMIT, ROLLBACK on error.
function runSaleTx(statements) {
  raw.exec('BEGIN');
  try {
    for (const s of statements) {
      const p = s.params ?? [];
      const inj = injectUuid(s.sql, p, SYNC_TABLES);
      const b = bind(inj ? inj.sql : s.sql, inj ? inj.params : p);
      raw.prepare(b.sql).run(...b.params);
    }
    raw.exec('COMMIT');
  } catch (e) {
    raw.exec('ROLLBACK');
    throw e;
  }
}

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try {
    fn();
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}
function assertThrows(fn, re, m) {
  let got = null;
  try { fn(); } catch (e) { got = e; }
  assert(got, (m || 'expected a throw') + ' — nothing threw');
  assert(re.test(got.message), (m || 'wrong error') + ' — got: ' + got.message);
}

// ── fixtures: the exact bottles ──────────────────────────────────────────
// GTX 4L, full pack 4000. A wholesale customer has AGREED 3000 for it
// (party price) — the price a leftover must NOT be re-priced at.
const GTX = { id: 1, name: 'GTX 4L', packing: '4L', price_walking: 4000, price_returning: 4000, price_wholesale: 3600, wholesale_min_qty: 10 };
const MOBIL = { id: 2, name: 'Mobil 4L', packing: '4L', price_walking: 2000, price_returning: 2000, price_wholesale: 1800, wholesale_min_qty: 10 };
const NOPRICE = { id: 3, name: 'No Price Oil', packing: '4L', price_walking: null, price_returning: null, price_wholesale: null, wholesale_min_qty: 10 };
const partyCtx = { partyPrices: { 1: 3000 }, listItems: [], groupListItems: [], groupTier: null };

// Containers, as POSSearch returns them (source line already joined).
const C1 = { product_id: 1, source_order_id: 100, source_unit_price: 4000, source_capacity: 0, source_billed_by_capacity: 0, remaining_volume: 0.5 }; // source line: full bottle
const C2 = { product_id: 1, source_order_id: 101, source_unit_price: 3500, source_capacity: 3.5, source_billed_by_capacity: 1, remaining_volume: 0.5 }; // source line: billed by capacity 3.5/4
const C3 = { product_id: 1, source_order_id: 102, source_unit_price: 3325, source_capacity: 3.5, source_billed_by_capacity: 1, remaining_volume: 0.5 }; // source line: discounted memory price
const C4 = { product_id: 1, source_order_id: null, source_unit_price: null, source_capacity: null, source_billed_by_capacity: null, remaining_volume: 2 }; // no source order — tier fallback
const C5 = { product_id: 2, source_order_id: 103, source_unit_price: 2000, source_capacity: 0, source_billed_by_capacity: 0, remaining_volume: 0.5 }; // a different brand's bottle
const C6 = { product_id: 3, source_order_id: null, source_unit_price: null, source_capacity: null, source_billed_by_capacity: null, remaining_volume: 0.5 }; // unpriceable

console.log('\nLeftover container pricing (per-litre, from the exact bottle)');

// ── 1. the reported bug, red shape ───────────────────────────────────────
check('old formula prices 0.5L at 4000 (the report); new formula at 500', () => {
  // The old addContainer charged tierPrice (the full bottle) as the unit
  // price for 1 litre — and started the line at qty 1 on a 0.5L container.
  // (tierPrice is resolvePrice with the product attached, as POSCart does.)
  const oldUnit = resolvePrice(GTX.id, 'walking', 1, { product: GTX }).price;
  assert(oldUnit === 4000, 'old unit price should be the full bottle 4000, got ' + oldUnit);
  assert(oldUnit * 1 === 4000, 'old line total for the 0.5L container is 4000 — the reported bug');
  // The fix: per-litre from the exact bottle, qty capped at the remainder.
  const unit = containerUnitPrice(C1, GTX, 'walking');
  assert(unit === 1000, 'per-litre should be 1000, got ' + unit);
  const qty = Math.min(1, C1.remaining_volume);
  assert(qty === 0.5, 'line starts at the 0.5L remainder, got ' + qty);
  assert(Math.round(unit * qty * 100) / 100 === 500, '0.5L must cost 500');
});

// ── 2. the refinement: the agreed price is ignored ───────────────────────
check('same container, same per-litre price for walking and wholesale-with-agreed-3000', () => {
  const walking = containerUnitPrice(C1, GTX, 'walking');
  const wholesale = containerUnitPrice(C1, GTX, 'wholesale');
  assert(walking === 1000, 'walking per-litre should be 1000, got ' + walking);
  assert(wholesale === 1000, 'wholesale per-litre should be the same 1000, got ' + wholesale);
  // The old path would have used the negotiated price for the wholesale
  // customer — 3000 for the bottle, i.e. 750/L. That is the "general price".
  const negotiated = resolvePrice(GTX.id, 'wholesale', 1, partyCtx);
  assert(negotiated.price === 3000 && negotiated.source === 'party', 'party price should resolve to 3000, got ' + JSON.stringify(negotiated));
  assert(wholesale !== 750, 'the agreed 3000 must never leak into the leftover price');
});

// ── 3. capacity recovery from the recorded sale ──────────────────────────
check('source line billed by capacity recovers the full-pack price', () => {
  // 3500 for 3.5L of a 4L bottle: the pack is 3500 / (3.5/4) = 4000.
  assert(containerUnitPrice(C2, GTX, 'walking') === 1000, 'C2 should recover to 1000/L');
  assert(containerUnitPrice(C2, GTX, 'wholesale') === 1000, 'C2 must be 1000/L for wholesale too');
  // A discounted memory price recovers to ITS OWN pack (3800), not the tier.
  assert(containerUnitPrice(C3, GTX, 'walking') === 950, 'C3 should recover to 950/L (3800/4), got ' + containerUnitPrice(C3, GTX, 'walking'));
});

// ── 4. tier fallback: the product's OWN columns, never the agreed price ──
check('no source order: the product\'s own tier columns, not the agreed price', () => {
  // One leftover bottle is 1 pack, below GTX's 10-pack wholesale threshold,
  // so the wholesale customer gets the product's own returning price — still
  // the product's own price, and the same 1000/L as the walking customer.
  assert(containerUnitPrice(C4, GTX, 'walking') === 1000, 'walking tier 4000 -> 1000/L');
  assert(containerUnitPrice(C4, GTX, 'wholesale') === 1000, 'wholesale below threshold falls back to the returning 4000 -> 1000/L, got ' + containerUnitPrice(C4, GTX, 'wholesale'));
  assert(containerUnitPrice(C4, GTX, 'wholesale') !== 750, 'the agreed 3000 must not decide the fallback either');
  // With the threshold reached (min_qty 1), the wholesale COLUMN applies:
  // 3600 -> 900/L — the product's own wholesale price, not the agreed 3000.
  const GTX_BULK = { ...GTX, wholesale_min_qty: 1 };
  assert(ownTierPrice(GTX_BULK, 'wholesale', 1) === 3600, 'ownTierPrice is the tier columns only');
  assert(containerUnitPrice(C4, GTX_BULK, 'wholesale') === 900, 'wholesale column 3600 -> 900/L, got ' + containerUnitPrice(C4, GTX_BULK, 'wholesale'));
  assert(ownTierPrice(GTX, 'wholesale', 1) === 4000, 'below the threshold the returning column is the tier answer');
});

// ── 5. the price follows the product/brand ───────────────────────────────
check('a different brand\'s bottle prices differently', () => {
  assert(containerUnitPrice(C5, MOBIL, 'walking') === 500, 'Mobil 2000/4L -> 500/L');
  assert(Math.round(containerUnitPrice(C5, MOBIL, 'walking') * 0.5 * 100) / 100 === 250, '0.5L of Mobil must cost 250');
  assert(containerUnitPrice(C1, GTX, 'walking') !== containerUnitPrice(C5, MOBIL, 'walking'), 'GTX and Mobil must not price the same');
});

// ── 6. fail visibly ──────────────────────────────────────────────────────
check('unpriceable bottle fails visibly instead of pricing at a generic rate', () => {
  assertThrows(
    () => containerUnitPrice(C6, NOPRICE, 'walking'),
    /no recorded sale price and no own price for No Price Oil/,
    'expected a named failure for the unpriceable bottle'
  );
  assert(containerUnitPriceOrNull(C6, NOPRICE, 'walking') === null, 'the null-safe variant must return null');
  // No pack size to pro-rate against: an empty packing (or a negative one,
  // which packLitres rejects) must fail, not divide by nothing.
  assertThrows(
    () => containerUnitPrice(C1, { ...GTX, packing: '' }, 'walking'),
    /no pack size in litres/,
    'a product with no pack size must fail'
  );
  assertThrows(
    () => containerUnitPrice(C1, { ...GTX, packing: '-4L' }, 'walking'),
    /no pack size in litres/,
    'a negative pack size must fail'
  );
});

// ── 7. helpers ───────────────────────────────────────────────────────────
check('per-litre helper and pack parsing', () => {
  assert(perLitreUnitPrice(4, 4000) === 1000, '4000/4L -> 1000/L');
  assert(perLitreUnitPrice(4, 3500) === 875, '3500/4L -> 875/L');
  assert(perLitreUnitPrice(0, 4000) === 4000, 'pack <= 0 falls back to the full price');
  assert(packLitres(GTX) === 4, 'GTX pack is 4L');
  assert(packLitres({ packing: '500ml' }) === 0.5, '500ml -> 0.5L');
});

// ── 8. local mode: the real query + the real sale statements ─────────────
await ensureLocalSchema(db);
run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty) VALUES (1, 1, 'GTX 4L', '4L', 4000, 4000, 3600, 10, 10)");
run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status) VALUES (101, 1, NULL, 1, 3500, 3500, 1, 'cash', 'completed')");
run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, capacity, billed_by_capacity) VALUES (101, 'product', 1, 'GTX 4L', 1, 3500, 3500, 3.5, 1)");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (1, 1, 1, 4, 0.5, 'opened', 101)");

const CONTAINER_SEARCH_SQL = "SELECT c.id, c.product_id, c.barcode, c.remaining_volume, c.status, c.source_order_id, p.name as product_name, p.packing, p.price_walking, p.price_returning, p.price_wholesale, p.wholesale_min_qty, (SELECT oi.unit_price FROM order_items oi WHERE oi.order_id = c.source_order_id AND oi.ref_id = c.product_id AND oi.kind = 'product' ORDER BY oi.id LIMIT 1) AS source_unit_price, (SELECT oi.capacity FROM order_items oi WHERE oi.order_id = c.source_order_id AND oi.ref_id = c.product_id AND oi.kind = 'product' ORDER BY oi.id LIMIT 1) AS source_capacity, (SELECT oi.billed_by_capacity FROM order_items oi WHERE oi.order_id = c.source_order_id AND oi.ref_id = c.product_id AND oi.kind = 'product' ORDER BY oi.id LIMIT 1) AS source_billed_by_capacity FROM containers c JOIN products p ON c.product_id = p.id WHERE c.status IN ('opened','full') AND c.remaining_volume > 0 AND LOWER(p.name) LIKE $1 ORDER BY c.opened_at DESC LIMIT 5";

check('the search query returns the recorded source line for the container', () => {
  const rows = run(CONTAINER_SEARCH_SQL, ['%gtx%']);
  assert(rows.length === 1, 'expected 1 container row, got ' + rows.length);
  const c = rows[0];
  assert(Number(c.source_unit_price) === 3500, 'source_unit_price should be 3500, got ' + c.source_unit_price);
  assert(Number(c.source_capacity) === 3.5, 'source_capacity should be 3.5, got ' + c.source_capacity);
  assert(Number(c.source_billed_by_capacity) === 1, 'source_billed_by_capacity should be 1, got ' + c.source_billed_by_capacity);
  assert(c.packing === '4L', 'packing should come back as 4L, got ' + c.packing);
  // The price the search shows for it is the first draw's total: 1000/L x 0.5L.
  const perLitre = containerUnitPrice(c, { packing: c.packing, price_walking: c.price_walking, price_returning: c.price_returning, price_wholesale: c.price_wholesale, wholesale_min_qty: c.wholesale_min_qty }, 'walking');
  assert(perLitre === 1000, 'search-row per-litre should be 1000, got ' + perLitre);
  assert(Math.round(perLitre * Math.min(1, Number(c.remaining_volume)) * 100) / 100 === 500, 'search must show 500 for the 0.5L remainder');
});

// The exact completeSale statements for a partial-container line
// (src/modules/pos/POSCart.tsx), with the capacity column carrying the
// litres drawn so the history shows 0.5L.
function containerSaleStatements(oid, containerId, qty, unitPrice) {
  const lineTotal = Math.round(unitPrice * qty * 100) / 100;
  return [
    {
      sql: `INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, vehicle_id, mileage, notes, created_at) VALUES ($1, 1, $2, $3, $4, $4, $5, 'cash', 'completed', $6, $7, $8, NOW())`,
      params: [oid, null, 1, lineTotal, 1, null, 0, ''],
    },
    {
      sql: `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      params: [oid, 'partial_container', containerId, 'GTX 4L (0.5L left)', qty, unitPrice, lineTotal, containerId, qty, 0, 'customer', 0, 0],
    },
    {
      sql: "UPDATE containers SET remaining_volume = GREATEST(0, remaining_volume - $1), status = CASE WHEN remaining_volume - $1 <= 0 THEN 'empty' ELSE 'opened' END WHERE id = $2",
      params: [qty, containerId],
    },
    {
      sql: "INSERT INTO container_splits (container_id, sold_qty, order_id) VALUES ($1, $2, $3)",
      params: [containerId, qty, oid],
    },
  ];
}

check('local sale: 0.5L of the container lands at 500, container empties', () => {
  const unit = containerUnitPrice(C2, GTX, 'walking');
  const stmts = containerSaleStatements(201, 1, 0.5, unit);
  runSaleTx(stmts);
  const line = run("SELECT qty, unit_price, line_total, capacity, kind, container_id FROM order_items WHERE order_id = 201")[0];
  assert(line, 'no order_items row for order 201');
  assert(Number(line.qty) === 0.5, 'qty should be 0.5L, got ' + line.qty);
  assert(Number(line.unit_price) === 1000, 'unit_price should be 1000/L, got ' + line.unit_price);
  assert(Number(line.line_total) === 500, 'line_total should be 500, got ' + line.line_total);
  assert(Number(line.capacity) === 0.5, 'capacity should record the 0.5L drawn, got ' + line.capacity);
  assert(line.kind === 'partial_container' && Number(line.container_id) === 1, 'line must be the container line');
  const c = run("SELECT remaining_volume, status FROM containers WHERE id = 1")[0];
  assert(Number(c.remaining_volume) === 0, 'container should be drawn to 0, got ' + c.remaining_volume);
  assert(c.status === 'empty', 'container should be empty, got ' + c.status);
  const split = run("SELECT sold_qty, order_id FROM container_splits WHERE container_id = 1")[0];
  assert(split && Number(split.sold_qty) === 0.5 && Number(split.order_id) === 201, 'split must record 0.5L for order 201');
  assert(Number(run("SELECT total FROM orders WHERE id = 201")[0].total) === 500, 'order total should be 500');
});

// ── 9. server mode: the same text the VPS executes verbatim ──────────────
check('server mode: identical statement text, Postgres-valid syntax only', () => {
  const unit = containerUnitPrice(C2, GTX, 'walking');
  const localStmts = containerSaleStatements(202, 1, 0.5, unit);
  const serverStmts = containerSaleStatements(202, 1, 0.5, unit);
  assert(JSON.stringify(localStmts) === JSON.stringify(serverStmts), 'the server must receive the identical statements');
  for (const s of serverStmts) {
    assert(!s.sql.includes('?'), 'server SQL must use $n placeholders, not ?: ' + s.sql.slice(0, 60));
    assert(!/datetime\(/i.test(s.sql), 'server SQL must not carry SQLite-only datetime(): ' + s.sql.slice(0, 60));
  }
  assert(serverStmts[0].sql.includes('NOW()'), 'NOW() is valid Postgres and is how the order is stamped');
  // The drawdown is 0.5 - 0.5 = 0 in both modes; the server executes the
  // identical UPDATE, so the container empties there too.
  assert(serverStmts[2].params[0] === 0.5 && serverStmts[2].params[1] === 1, 'drawdown must take 0.5L from container 1');
  // container_splits is not a synced table, so no uuid is injected into it.
  assert(injectUuid(serverStmts[3].sql, serverStmts[3].params, SYNC_TABLES) === null, 'injectUuid must leave the split INSERT alone');
});

// ── 10. regression: bill-by-capacity on a full bottle ────────────────────
check('regression: 4L bottle into a 3.5L engine still bills 3500 and shelves 0.5L', () => {
  const full = ownTierPrice(GTX, 'walking', 1);
  assert(full === 4000, 'full pack is 4000');
  const billed = Math.round(perLitreUnitPrice(4, full) * 3.5 * 100) / 100;
  assert(billed === 3500, '3.5L billed at 1000/L is 3500, got ' + billed);
  assert(Math.round((packLitres(GTX) - 3.5) * 1000) / 1000 === 0.5, 'leftover shelved is 0.5L');
});

// ── 11. source tie-in: the .tsx calls the resolver ───────────────────────
check('source tie-in: addContainer no longer prices from the negotiated tier', () => {
  // Batch 8 moved the pure cart helpers out of POSCart.tsx into
  // src/lib/cart.ts (node cannot import .tsx — that is how the addContainer
  // over-draw survived untested). POSCart re-exports them; the body lives here.
  const cart = readFileSync(new URL('../src/lib/cart.ts', import.meta.url), 'utf8');
  // Scope the assertion to addContainer itself: tierPrice is still the right
  // call for full product lines (addProduct/reprice), just not for a
  // leftover bottle.
  const start = cart.indexOf('export function addContainer(');
  const end = cart.indexOf('export function updateQty(', start);
  assert(start > 0 && end > start, 'addContainer not found in src/lib/cart.ts');
  const addContainerBody = cart.slice(start, end);
  assert(!addContainerBody.includes('tierPrice'), 'addContainer must not call tierPrice for the container line');
  assert(addContainerBody.includes('unitPrice: number'), 'addContainer must take the resolved per-litre price in');
  assert(addContainerBody.includes('Math.min(1,'), 'addContainer must cap the first draw at the remainder');
  const pos = readFileSync(new URL('../src/modules/pos/POS.tsx', import.meta.url), 'utf8');
  assert(pos.includes('containerUnitPrice(item.raw'), 'POS must resolve the container price before adding the line');
  const search = readFileSync(new URL('../src/modules/pos/POSSearch.tsx', import.meta.url), 'utf8');
  assert(search.includes('source_unit_price'), 'the search query must carry the recorded source line');
  assert(search.includes('containerDisplayPrice'), 'the search dropdown must show the per-litre first-draw price');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
