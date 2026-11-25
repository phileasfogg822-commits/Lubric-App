/**
 * Overselling — "the stock goes in negative as well, even the stock is
 * finished, but i am still able to sale that product, the containers were
 * showing 1 extra leftover, and it went to negative 0.5l and the item in
 * the product went to negative 2" (Umar, 2026-11-25 ~18:54 PKT, on v8).
 * The 2067 is FIXED — the sale works now — but nothing ever checked stock:
 *
 *  1. completeSale built its statements with no availability check at all.
 *     stockOut just appends a negative movement, so products.stock_qty
 *     went to -2 on a finished product.
 *  2. The partial-container drawdown was the only sale-path UPDATE without
 *     a GREATEST(0, ...) clamp (the edit/void paths already clamp), so a
 *     draw past what the bottle held drove remaining_volume to -0.5L.
 *  3. addContainer's second tap added a whole litre whenever qty <
 *     remaining, so a 1.2L bottle went to 2.0L in the cart — the over-draw
 *     that made the -0.5L row. addProduct had no ceiling at all.
 *  4. The "1 extra leftover": v6-era retries committed the container
 *     INSERT while the order never landed (an orphan), and the next sale
 *     reusing the gap oid shelved the same bottle again — two rows for
 *     one bottle, both offered by the picker.
 *
 * The fix (this batch): validateSaleStock (src/lib/cart.ts) runs first in
 * completeSale — before the order id is reserved and before the vehicle is
 * touched — and throws naming the product and the amount left; the cart
 * caps (addProduct stops at stock_qty, addContainer's second tap is
 * min(qty+1, remaining), updateQty clamps to max_qty); the drawdown SQL
 * clamps with GREATEST(0, ...); the launch repairs clamp negatives and
 * empty duplicate/orphan containers. The pure cart helpers moved from
 * POSCart.tsx to src/lib/cart.ts so this sim can import the REAL ones
 * (node cannot import .tsx); POSCart re-exports them.
 *
 * Run:  node --experimental-strip-types server/sim_sale_stock_guard.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  ensureLocalSchema,
  pgToSqlite,
  LOCAL_SCHEMA,
  LOCAL_SCHEMA_2,
  LOCAL_SCHEMA_3,
  LOCAL_SCHEMA_4,
  LOCAL_SCHEMA_5,
  LOCAL_SCHEMA_6,
  LOCAL_SCHEMA_7,
  LOCAL_SCHEMA_8,
  LOCAL_SCHEMA_9,
} from '../src/lib/localDb.ts';
import { injectUuid } from '../src/lib/outbox.ts';
import { SYNC_TABLES } from '../src/lib/sync.ts';
import { stockOut } from '../src/lib/stock.ts';
import { newUuid } from '../src/lib/uuid.ts';
import { packLitres } from '../src/lib/units.ts';
import {
  addProduct,
  addContainer,
  updateQty,
  leftoverLitres,
  validateSaleStock,
} from '../src/lib/cart.ts';

// ── sqlx-faithful binding (copied from sim_sale_uuid_binding.js) ─────────
function sqlxBind(sql, params = []) {
  let out = '';
  const ordered = [];
  let unnamed = 0;
  let single = false;
  let dbl = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (single) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") out += sql[++i];
        else single = false;
      }
      continue;
    }
    if (dbl) {
      out += ch;
      if (ch === '"') {
        if (sql[i + 1] === '"') out += sql[++i];
        else dbl = false;
      }
      continue;
    }
    if (ch === "'") { single = true; out += ch; continue; }
    if (ch === '"') { dbl = true; out += ch; continue; }
    if (ch === '$' && /[0-9]/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (/[0-9]/.test(sql[j] ?? '')) j++;
      ordered.push(params[Number(sql.slice(i + 1, j)) - 1]);
      out += '?';
      i = j - 1;
      continue;
    }
    if (ch === '?') {
      ordered.push(params[unnamed++]);
      out += '?';
      continue;
    }
    out += ch;
  }
  return { sql: out, params: ordered };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── one in-memory DB, schema init once ───────────────────────────────────
const raw = new DatabaseSync(':memory:');
const db = {
  execute: async (sql) => raw.exec(sql),
  select: async (sql) => raw.prepare(sql).all(),
};
function run(sql, params = []) {
  const b = sqlxBind(pgToSqlite(sql), params);
  return raw.prepare(b.sql).all(...b.params);
}
function runExecute(sql, params = []) {
  const inj = injectUuid(sql, params, SYNC_TABLES);
  const finalSql = inj ? inj.sql : sql;
  const finalParams = inj ? inj.params : params;
  const b = sqlxBind(pgToSqlite(finalSql), finalParams);
  if (/\breturning\b/i.test(finalSql)) {
    return raw.prepare(b.sql).all(...b.params);
  }
  raw.prepare(b.sql).run(...b.params);
  return [];
}
function runSaleTx(statements) {
  raw.exec('BEGIN');
  try {
    for (const s of statements) {
      const p = s.params ?? [];
      const inj = injectUuid(s.sql, p, SYNC_TABLES);
      const b = sqlxBind(pgToSqlite(inj ? inj.sql : s.sql), inj ? inj.params : p);
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

// The exact completeSale statement construction (POSCart.tsx), copied
// verbatim from sim_sale_uuid_binding.js — including the clamped drawdown.
// The guard itself is NOT copied: the harness calls the REAL
// validateSaleStock first, exactly as completeSale now does.
function buildSaleStatements(oid, cart, customerId, userId, paymentAccountId, total, mileage, notes, vehicleId) {
  const statements = [
    {
      sql: `INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, vehicle_id, mileage, notes, created_at) VALUES ($1, 1, $2, $3, $4, $4, $5, 'cash', 'completed', $6, $7, $8, NOW())`,
      params: [oid, customerId, userId, total, paymentAccountId, vehicleId, mileage, notes],
    },
  ];
  for (const item of cart) {
    const lo = item.kind === 'product' ? leftoverLitres(item) : 0;
    const toContainers = item.kind === 'product' && !!item.leftoverToContainers && lo > 0;
    const byCapacity = item.kind === 'product' && !!item.billByCapacity;
    statements.push({
      sql: `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      params: [oid, item.kind, item.ref_id, item.name, item.qty, item.unit_price, item.line_total, item.container_id ?? null,
               item.kind === 'partial_container' ? item.qty : (item.kind === 'product' ? (item.capacity ?? 0) : 0), lo, toContainers ? 'container' : 'customer', false, byCapacity],
    });
    if (toContainers) {
      statements.push({
        sql: "INSERT INTO containers (shop_id, product_id, original_volume, remaining_volume, status, opened_at, source_order_id) VALUES (1, $1, $2, $3, 'opened', NOW()::text, $4)",
        params: [item.ref_id, packLitres(item.product) || lo, lo, oid],
      });
    }
    if (item.kind === 'product') {
      statements.push(
        ...stockOut(item.ref_id, item.qty, 'sale', newUuid(), { table: 'orders', id: oid })
      );
    }
    if (item.kind === 'partial_container' && item.container_id) {
      statements.push({ sql: "UPDATE containers SET remaining_volume = GREATEST(0, remaining_volume - $1), status = CASE WHEN remaining_volume - $1 <= 0 THEN 'empty' ELSE 'opened' END WHERE id = $2", params: [item.qty, item.container_id] });
      statements.push({ sql: 'INSERT INTO container_splits (container_id, sold_qty, order_id) VALUES ($1, $2, $3)', params: [item.container_id, item.qty, oid] });
    }
    if (item.kind === 'used_oil') {
      statements.push({ sql: 'UPDATE used_oil_drum SET current_litres = current_litres + $1 WHERE id = 1', params: [item.qty] });
      statements.push({ sql: "INSERT INTO used_oil_log (drum_id, litres, type, source_order_id) VALUES (1, $1, 'added', $2)", params: [item.qty, oid] });
    }
  }
  if (total > 0) {
    statements.push({ sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [total, paymentAccountId] });
    statements.push({ sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1, $2, 'in', $3)", params: [paymentAccountId, total, `Order #${oid}`] });
  }
  if (customerId) {
    statements.push({ sql: 'UPDATE customers SET last_visit_at = NOW() WHERE id = $1', params: [customerId] });
  }
  return statements;
}

function nextOid() {
  return Number(run('SELECT COALESCE(MAX(id), 0) + 1 AS oid FROM orders')[0].oid);
}

// Mirrors completeSale's new order: read live availability, validate, and
// only then build + run the transaction. A blocked sale writes nothing.
function guardedSale(cart, customerId, userId, paymentAccountId, total, mileage, notes, vehicleId) {
  const stockById = new Map();
  for (const pid of [...new Set(cart.filter((x) => x.kind === 'product' && x.qty > 0).map((x) => x.ref_id))]) {
    const row = run('SELECT name, stock_qty FROM products WHERE id = $1', [pid])[0];
    stockById.set(pid, { name: row?.name ?? `product #${pid}`, qty: Number(row?.stock_qty ?? 0) || 0 });
  }
  const containersById = new Map();
  for (const cid of [...new Set(cart.filter((x) => x.kind === 'partial_container' && x.qty > 0 && x.container_id).map((x) => x.container_id))]) {
    const row = run('SELECT p.name AS product_name, c.remaining_volume FROM containers c JOIN products p ON p.id = c.product_id WHERE c.id = $1', [cid])[0];
    containersById.set(cid, { name: row?.product_name ?? `container #${cid}`, remaining: Number(row?.remaining_volume ?? 0) || 0 });
  }
  const short = validateSaleStock(cart, stockById, containersById);
  if (short) throw new Error(short);
  const oid = nextOid();
  runSaleTx(buildSaleStatements(oid, cart, customerId, userId, paymentAccountId, total, mileage, notes, vehicleId));
  return oid;
}

const POSCART = readFileSync(new URL('../src/modules/pos/POSCart.tsx', import.meta.url), 'utf8');
const LOCALDB = readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');
const EDITSALE = readFileSync(new URL('../src/modules/sales/editSale.ts', import.meta.url), 'utf8');
const POS = readFileSync(new URL('../src/modules/pos/POS.tsx', import.meta.url), 'utf8');
const CART = readFileSync(new URL('../src/lib/cart.ts', import.meta.url), 'utf8');

console.log('\nOverselling: the sale must never take more than the shop has');

// ── Part 1 — the damaged seed, then schema init (the repairs) ───────────
// Umar's evidence, 2026-11-25 ~18:54 PKT: zic at -2, a container at -0.5L
// (opened 2026-11-24 14:17), and 1 extra leftover. The seed below is that
// state: product 3 (Zic 4L) at -2 with its stock_levels row at -2,
// container 8 at -0.5L, containers 9+10 the duplicate pair for order 9,
// container 11 the orphan (no order 99). Healthy controls alongside.
raw.exec(LOCAL_SCHEMA);
raw.exec(LOCAL_SCHEMA_2);
raw.exec(LOCAL_SCHEMA_3);
raw.exec(LOCAL_SCHEMA_4);
raw.exec(LOCAL_SCHEMA_5);
raw.exec(LOCAL_SCHEMA_6);
raw.exec(LOCAL_SCHEMA_7);
raw.exec(LOCAL_SCHEMA_8);
raw.exec(LOCAL_SCHEMA_9);
run("INSERT INTO warehouses (id, uuid, shop_id, name, code, is_default, active) VALUES (1, 'wh-test', 1, 'Main Store', 'MAIN', 1, 1)");
run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (1, 1, 'GTX 4L', '4L', 4000, 4000, 3600, 10, 2, 1)");
run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (2, 1, 'Engine Oil 1L', '1L', 900, 900, 800, 10, 0, 1)");
run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (3, 1, 'Zic 4L', '4L', 4000, 4000, 3600, 10, -2, 1)");
run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (4, 1, 'Engine Oil 5L', '5L', 4500, 4500, 4000, 10, 5, 1)");
run("INSERT INTO stock_levels (warehouse_id, product_id, qty) VALUES (1, 1, 2)");
run("INSERT INTO stock_levels (warehouse_id, product_id, qty) VALUES (1, 3, -2)");
run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status) VALUES (1, 1, 3, 1, 4000, 4000, 1, 'cash', 'completed')");
run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status) VALUES (2, 1, 3, 1, 4000, 4000, 1, 'cash', 'completed')");
run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status) VALUES (9, 1, 3, 1, 4000, 4000, 1, 'cash', 'completed')");
run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total) VALUES (1, 'product', 1, 'GTX 4L', 1, 4000, 4000)");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (5, 1, 1, 4, 2.5, 'opened', 1)");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (6, 1, 1, 4, 0.5, 'opened', 2)");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (7, 1, 3, 4, 1.2, 'opened', 1)");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (8, 1, 3, 4, -0.5, 'empty', 2)");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (9, 1, 1, 4, 0.5, 'opened', 9)");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (10, 1, 1, 4, 0.5, 'opened', 9)");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (11, 1, 1, 4, 0.5, 'opened', 99)");

await ensureLocalSchema(db);

check('REPAIR: a product at -2 stock is clamped to 0 (both caches)', () => {
  assert(Number(run('SELECT stock_qty FROM products WHERE id = 3')[0].stock_qty) === 0, 'Zic stock_qty must be 0 after the repair');
  assert(Number(run('SELECT qty FROM stock_levels WHERE product_id = 3')[0].qty) === 0, 'Zic stock_levels qty must be 0 after the repair');
});
check('REPAIR: a container at -0.5L is emptied to 0', () => {
  const c = run('SELECT remaining_volume, status FROM containers WHERE id = 8')[0];
  assert(Number(c.remaining_volume) === 0 && c.status === 'empty', 'the -0.5L container must read 0/empty, got ' + JSON.stringify(c));
});
check('REPAIR: the duplicate pair keeps only the first row — the phantom extra leaves', () => {
  const a = run('SELECT remaining_volume, status FROM containers WHERE id = 9')[0];
  const b = run('SELECT remaining_volume, status FROM containers WHERE id = 10')[0];
  assert(Number(a.remaining_volume) === 0.5 && a.status === 'opened', 'the first row keeps the 0.5L, got ' + JSON.stringify(a));
  assert(Number(b.remaining_volume) === 0 && b.status === 'empty', 'the duplicate must be emptied, got ' + JSON.stringify(b));
});
check('REPAIR: the orphan container (order 99 never landed) is emptied', () => {
  const c = run('SELECT remaining_volume, status FROM containers WHERE id = 11')[0];
  assert(Number(c.remaining_volume) === 0 && c.status === 'empty', 'the orphan must be emptied, got ' + JSON.stringify(c));
});
check('REPAIR: healthy rows are untouched', () => {
  assert(Number(run('SELECT stock_qty FROM products WHERE id = 1')[0].stock_qty) === 2, 'GTX stock must stay 2');
  assert(Number(run('SELECT qty FROM stock_levels WHERE product_id = 1')[0].qty) === 2, 'GTX stock_levels must stay 2');
  assert(Number(run('SELECT remaining_volume FROM containers WHERE id = 5')[0].remaining_volume) === 2.5, 'container 5 must stay 2.5L');
  assert(Number(run('SELECT remaining_volume FROM containers WHERE id = 6')[0].remaining_volume) === 0.5, 'container 6 must stay 0.5L');
});

const PICKER_SQL = `SELECT c.id, c.product_id, c.barcode, c.remaining_volume, c.status, c.source_order_id, p.name as product_name, p.packing, p.price_walking, p.price_returning, p.price_wholesale, p.wholesale_min_qty, (SELECT oi.unit_price FROM order_items oi WHERE oi.order_id = c.source_order_id AND oi.ref_id = c.product_id AND oi.kind = 'product' ORDER BY oi.id LIMIT 1) AS source_unit_price, (SELECT oi.capacity FROM order_items oi WHERE oi.order_id = c.source_order_id AND oi.ref_id = c.product_id AND oi.kind = 'product' ORDER BY oi.id LIMIT 1) AS source_capacity, (SELECT oi.billed_by_capacity FROM order_items oi WHERE oi.order_id = c.source_order_id AND oi.ref_id = c.product_id AND oi.kind = 'product' ORDER BY oi.id LIMIT 1) AS source_billed_by_capacity FROM containers c JOIN products p ON c.product_id = p.id WHERE c.status IN ('opened','full') AND c.remaining_volume > 0 AND LOWER(p.name) LIKE $1 ORDER BY c.opened_at DESC LIMIT 5`;
function pickerRows(q) {
  return run(PICKER_SQL, [q]);
}

check('PICKER: after the repair it offers each bottle once, and never a 0/negative one', () => {
  const gtx = pickerRows('%gtx%').map((r) => r.id);
  assert(gtx.includes(5) && gtx.includes(6) && gtx.includes(9), 'containers 5, 6 and 9 must be offered, got ' + JSON.stringify(gtx));
  assert(!gtx.includes(10), 'the duplicate container 10 must NOT be offered');
  assert(!gtx.includes(11), 'the orphan container 11 must NOT be offered');
  const zic = pickerRows('%zic%').map((r) => r.id);
  assert(zic.includes(7) && !zic.includes(8), 'container 7 offered, repaired container 8 not offered, got ' + JSON.stringify(zic));
});

// ── Part 2 — the validator, pure ─────────────────────────────────────────
const prodA = { id: 1, name: 'GTX 4L', packing: '4L' };
const prodB = { id: 2, name: 'Engine Oil 1L', packing: '1L' };
const prodC = { id: 3, name: 'Zic 4L', packing: '4L' };
const prodD = { id: 4, name: 'Engine Oil 5L', packing: '5L' };

check('GUARD: selling 3 of a product with 2 in stock is blocked and names the product + the amount left', () => {
  const err = validateSaleStock(
    [{ kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 3 }],
    new Map([[1, { name: 'GTX 4L', qty: 2 }]]), new Map());
  assert(err !== null && /GTX 4L/.test(err) && /only 2/.test(err) && /needs 3/.test(err),
    'the error must name GTX 4L, "only 2" and "needs 3", got: ' + err);
});
check('GUARD: selling exactly what is in stock passes', () => {
  const err = validateSaleStock(
    [{ kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 2 }],
    new Map([[1, { name: 'GTX 4L', qty: 2 }]]), new Map());
  assert(err === null, 'an exact-stock sale must pass, got: ' + err);
});
check('GUARD: two lines of the same product are summed before the check', () => {
  const err = validateSaleStock(
    [{ kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 2 }, { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 2 }],
    new Map([[1, { name: 'GTX 4L', qty: 3 }]]), new Map());
  assert(err !== null && /needs 4/.test(err), 'two lines of 2 against stock 3 must be blocked as 4, got: ' + err);
});
check('GUARD: a finished product (0 stock) cannot be sold at all', () => {
  const err = validateSaleStock(
    [{ kind: 'product', ref_id: 2, name: 'Engine Oil 1L', qty: 1 }],
    new Map([[2, { name: 'Engine Oil 1L', qty: 0 }]]), new Map());
  assert(err !== null && /Engine Oil 1L/.test(err) && /only 0/.test(err), 'got: ' + err);
});
check('GUARD: a product missing from the snapshot counts as zero on hand', () => {
  const err = validateSaleStock(
    [{ kind: 'product', ref_id: 99, name: 'Ghost Oil', qty: 1 }],
    new Map(), new Map());
  assert(err !== null, 'an unknown product must be blocked, got: ' + err);
});
check('GUARD: drawing 1L from a container with 0.5L left is blocked and names the litres', () => {
  const err = validateSaleStock(
    [{ kind: 'partial_container', ref_id: 6, name: 'GTX 4L (0.5L left)', qty: 1, container_id: 6 }],
    new Map(), new Map([[6, { name: 'GTX 4L', remaining: 0.5 }]]));
  assert(err !== null && /0.5L/.test(err) && /needs 1L/.test(err), 'got: ' + err);
});
check('GUARD: drawing exactly what is left passes', () => {
  const err = validateSaleStock(
    [{ kind: 'partial_container', ref_id: 6, name: 'GTX 4L (0.5L left)', qty: 0.5, container_id: 6 }],
    new Map(), new Map([[6, { name: 'GTX 4L', remaining: 0.5 }]]));
  assert(err === null, 'an exact draw must pass, got: ' + err);
});
check('GUARD: zero-qty lines are ignored', () => {
  const err = validateSaleStock(
    [{ kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 0 }],
    new Map([[1, { name: 'GTX 4L', qty: 0 }]]), new Map());
  assert(err === null, 'a zero-qty line must not block, got: ' + err);
});
check('GUARD (edit shape): growing a line by 2 when 1 is in stock is blocked', () => {
  const err = validateSaleStock(
    [{ kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 2 }],
    new Map([[1, { name: 'GTX 4L', qty: 1 }]]), new Map());
  assert(err !== null, 'the edit net-out must be blocked, got: ' + err);
});

// ── Part 3 — the cart caps, real helpers ─────────────────────────────────
check('CART: tapping a stock-2 product three times stops at 2', () => {
  const p = { id: 1, name: 'GTX 4L', packing: '4L', stock_qty: 2, price_walking: 4000, price_returning: 4000, price_wholesale: 3600, wholesale_min_qty: 10 };
  let cart = [];
  cart = addProduct(cart, p, 'walking', [p], {});
  cart = addProduct(cart, p, 'walking', [p], {});
  cart = addProduct(cart, p, 'walking', [p], {});
  assert(cart.length === 1 && cart[0].qty === 2, 'the line must stop at 2, got ' + JSON.stringify(cart.map((x) => x.qty)));
});
check('CART: a finished product (0 stock) is not added to the cart at all', () => {
  const p = { id: 2, name: 'Engine Oil 1L', packing: '1L', stock_qty: 0, price_walking: 900, price_returning: 900, price_wholesale: 800, wholesale_min_qty: 10 };
  const cart = addProduct([], p, 'walking', [p], {});
  assert(cart.length === 0, 'no line may be added for a 0-stock product, got ' + cart.length);
});
check('CART: a product with no recorded stock (NULL stock_qty) is treated as 0 — no line', () => {
  const p = { id: 4, name: 'Engine Oil 5L', packing: '5L', stock_qty: null, price_walking: 4500, price_returning: 4500, price_wholesale: 4000, wholesale_min_qty: 10 };
  const cart = addProduct([], p, 'walking', [p], {});
  assert(cart.length === 0, 'NULL stock reads as 0 on hand (the column defaults to 0), so no line may be added, got ' + cart.length);
});
check('CART: a second tap on a 1.2L container draws 1.2L, not 2.0L (the over-draw bug)', () => {
  const c = { id: 7, remaining_volume: 1.2, product_name: 'Zic 4L' };
  let cart = addContainer([], c, 1000);
  assert(cart.length === 1 && cart[0].qty === 1, 'the first tap draws 1L, got ' + JSON.stringify(cart.map((x) => x.qty)));
  cart = addContainer(cart, c, 1000);
  assert(cart[0].qty === 1.2, 'the second tap must stop at the 1.2L the bottle holds, got ' + cart[0].qty);
  cart = addContainer(cart, c, 1000);
  assert(cart[0].qty === 1.2, 'a third tap must not move it, got ' + cart[0].qty);
});
check('CART: a 0.5L container starts at 0.5L and a second tap is a no-op', () => {
  const c = { id: 6, remaining_volume: 0.5, product_name: 'GTX 4L' };
  let cart = addContainer([], c, 1000);
  assert(cart.length === 1 && cart[0].qty === 0.5, 'the first tap draws the whole 0.5L, got ' + JSON.stringify(cart.map((x) => x.qty)));
  cart = addContainer(cart, c, 1000);
  assert(cart[0].qty === 0.5, 'the second tap must not move it, got ' + cart[0].qty);
});
check('CART: a typed quantity is clamped to the line max_qty (stock at add time)', () => {
  const p = { id: 1, name: 'GTX 4L', packing: '4L', stock_qty: 2, price_walking: 4000, price_returning: 4000, price_wholesale: 3600, wholesale_min_qty: 10 };
  let cart = addProduct([], p, 'walking', [p], {});
  cart = updateQty(cart, cart[0].id, 5, 'walking', {});
  assert(cart[0].qty === 2, 'typing 5 must clamp to the 2 in stock, got ' + cart[0].qty);
  const c = { id: 5, remaining_volume: 2.5, product_name: 'GTX 4L' };
  let cc = addContainer([], c, 1000);
  cc = updateQty(cc, cc[0].id, 9, 'walking', {});
  assert(cc[0].qty === 2.5, 'typing 9L must clamp to the 2.5L in the bottle, got ' + cc[0].qty);
});

// ── Part 4 — guarded sales, end to end ───────────────────────────────────
run("INSERT INTO customers (id, shop_id, name, phone, customer_type) VALUES (3, 1, 'Ahmed Raza', '03001234567', 'walking')");
run("INSERT INTO services (id, shop_id, name, price, active) VALUES (1, 1, 'Oil Change', 500, 1)");

check('SALE: selling 3 of a product with 2 in stock is blocked — stock unchanged, no order', () => {
  const before = Number(run('SELECT stock_qty FROM products WHERE id = 1')[0].stock_qty);
  const ordersBefore = Number(run('SELECT COUNT(*) AS c FROM orders')[0].c);
  assertThrows(() => guardedSale(
    [{ kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 3, unit_price: 4000, line_total: 12000, product: prodA }],
    3, 1, 1, 12000, 0, '', null),
    /Not enough stock for GTX 4L — only 2 left, this sale needs 3/);
  assert(Number(run('SELECT stock_qty FROM products WHERE id = 1')[0].stock_qty) === before, 'the stock must not move on a blocked sale');
  assert(Number(run('SELECT COUNT(*) AS c FROM orders')[0].c) === ordersBefore, 'no order may be created by a blocked sale');
});

check('SALE: drawing 1L from a 0.5L container is blocked — remaining unchanged, no order', () => {
  const before = Number(run('SELECT remaining_volume FROM containers WHERE id = 6')[0].remaining_volume);
  assertThrows(() => guardedSale(
    [{ kind: 'partial_container', ref_id: 6, name: 'GTX 4L (0.5L left)', qty: 1, unit_price: 1000, line_total: 1000, container_id: 6, max_qty: 0.5 }],
    3, 1, 1, 1000, 0, '', null),
    /Not enough leftover in the GTX 4L container — only 0\.5L left, this sale needs 1L/);
  assert(Number(run('SELECT remaining_volume FROM containers WHERE id = 6')[0].remaining_volume) === before, 'the container must not move on a blocked sale');
});

check('SALE: a valid two-item sale still completes, no 2067, stock drops exactly once per line', () => {
  const oid = guardedSale(
    [
      { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
      { kind: 'product', ref_id: 4, name: 'Engine Oil 5L', qty: 1, unit_price: 4500, line_total: 4500, product: prodD },
    ],
    3, 1, 1, 8500, 0, '', null);
  assert(Number(run('SELECT stock_qty FROM products WHERE id = 1')[0].stock_qty) === 1, 'GTX must drop 2 -> 1');
  assert(Number(run('SELECT stock_qty FROM products WHERE id = 4')[0].stock_qty) === 4, '5L must drop 5 -> 4');
  const uuids = run('SELECT uuid FROM order_items WHERE order_id = ?', [oid]);
  assert(uuids.length === 2 && new Set(uuids.map((r) => r.uuid)).size === 2, 'the two lines must carry distinct uuids');
  assert(uuids.every((r) => UUID_V4.test(r.uuid)), 'every line must carry a real v4 uuid');
});

check('SALE: a second sale on the same account completes — no 2067 on account_transactions.uuid', () => {
  const oid = guardedSale(
    [{ kind: 'product', ref_id: 4, name: 'Engine Oil 5L', qty: 1, unit_price: 4500, line_total: 4500, product: prodD }],
    3, 1, 1, 4500, 0, '', null);
  const u = run('SELECT uuid FROM account_transactions WHERE reference = ?', [`Order #${oid}`])[0].uuid;
  assert(UUID_V4.test(u), 'the account row must carry a real v4 uuid, got ' + u);
  assert(Number(run('SELECT stock_qty FROM products WHERE id = 4')[0].stock_qty) === 3, '5L must drop 4 -> 3');
});

check('SALE: a valid container draw completes and the drained container leaves the picker', () => {
  const oid = guardedSale(
    [{ kind: 'partial_container', ref_id: 6, name: 'GTX 4L (0.5L left)', qty: 0.5, unit_price: 1000, line_total: 500, container_id: 6, max_qty: 0.5 }],
    3, 1, 1, 500, 0, '', null);
  const c = run('SELECT remaining_volume, status FROM containers WHERE id = 6')[0];
  assert(Number(c.remaining_volume) === 0 && c.status === 'empty', 'the container must be drained to 0/empty, got ' + JSON.stringify(c));
  assert(!pickerRows('%gtx%').some((r) => r.id === 6), 'the drained container must leave the picker');
  const split = run('SELECT sold_qty, order_id FROM container_splits WHERE container_id = 6');
  assert(split.length === 1 && Number(split[0].sold_qty) === 0.5 && split[0].order_id === oid, 'the draw must be recorded');
});

// The clamp, proven against the REAL statement text in POSCart.tsx: extract
// the partial_container UPDATE and run it with a draw past what is left.
// On the old code the extracted SQL is unclamped and the bottle goes
// negative — that is the red proof.
function drawdownSqlFromSource() {
  const m = POSCART.match(/UPDATE containers SET remaining_volume = [^"]*?WHERE id = \$2/);
  assert(m, 'the partial_container UPDATE must exist in POSCart.tsx');
  return m[0];
}
check('CLAMP: the drawdown SQL from POSCart.tsx never takes a bottle below 0, even forced', () => {
  const sql = drawdownSqlFromSource();
  assert(sql.includes('GREATEST(0, remaining_volume - $1)'), 'the drawdown must clamp with GREATEST(0, ...), got: ' + sql);
  run(sql, [2.0, 5]); // draw 2.0L from container 5 — it holds 2.5L
  assert(Number(run('SELECT remaining_volume FROM containers WHERE id = 5')[0].remaining_volume) === 0.5, 'a legal draw still lands at 0.5');
  run(sql, [9.0, 5]); // draw 9.0L from the 0.5L left — must stop at 0, never negative
  const c = run('SELECT remaining_volume, status FROM containers WHERE id = 5')[0];
  assert(Number(c.remaining_volume) === 0, 'an over-draw must stop at 0, got ' + c.remaining_volume);
  assert(c.status === 'empty', 'the over-drawn container must be empty, got ' + c.status);
});

// ── Part 5 — the wiring, pinned in source ───────────────────────────────
check('WIRING: pgToSqlite translates GREATEST(0, ...) to SQLite MAX(0, ...) — the clamp works locally', () => {
  const out = pgToSqlite("UPDATE containers SET remaining_volume = GREATEST(0, remaining_volume - $1) WHERE id = $2");
  assert(out.includes("MAX(0, remaining_volume - $1)"), 'GREATEST must become MAX (placeholders are the binder\'s job), got: ' + out);
  assert(!/GREATEST/i.test(out), 'no GREATEST may survive the translation — SQLite has no such function');
});
check('WIRING: completeSale validates stock before reserving the order id or touching the vehicle', () => {
  const guardAt = POSCART.indexOf('validateSaleStock(cart, stockById, containersById)');
  const nextvalAt = POSCART.indexOf("nextval(pg_get_serial_sequence('orders', 'id'))");
  const vehicleAt = POSCART.indexOf('SELECT id FROM vehicles WHERE customer_id');
  assert(guardAt > 0, 'completeSale must call validateSaleStock');
  assert(guardAt < nextvalAt, 'the guard must run before the order id is reserved');
  assert(guardAt < vehicleAt, 'the guard must run before the vehicle is touched');
});
check('WIRING: saveOrderEdits guards a net stock-out with the same validator', () => {
  assert(EDITSALE.includes('validateSaleStock(outLines, stockById, new Map())'),
    'saveOrderEdits must validate its net-out deltas');
});
check('WIRING: the launch repairs run in ensureLocalSchema', () => {
  assert(LOCALDB.includes('await patchNegativeStock(db);'), 'ensureLocalSchema must call patchNegativeStock');
  assert(LOCALDB.includes('await patchDuplicateContainers(db);'), 'ensureLocalSchema must call patchDuplicateContainers');
});
check('WIRING: the cart caps live in the real helpers (not a copy)', () => {
  assert(CART.includes('Math.min(x.qty + 1, cap)'), 'addProduct must cap the increment at stock');
  assert(CART.includes('Math.min(x.qty + 1, remaining)'), 'addContainer must cap the second tap at what is left');
  assert(CART.includes('if (!(cap > 0)) return cart;'), 'addProduct must refuse a fresh line at zero stock');
});
check('WIRING: POS shows the out-of-stock reason instead of adding the line', () => {
  assert(POS.includes('is out of stock — nothing left to sell.'), 'POS must carry the out-of-stock message');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
