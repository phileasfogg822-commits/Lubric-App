/**
 * Deterministic 2067 on completing sales — the 2026-11-25 ~14:50 PKT report:
 * "error returned from database: (code: 2067) UNIQUE constraint failed:
 * order_items.uuid — still getting this issue on the win app, it happens on
 * completing sales".
 *
 * Batch 4 (head eeb6634) assumed the 2067 came from pre-existing duplicate
 * uuids (repaired at schema init) plus a double-submit (submittingRef guard
 * in POS.tsx). Both fixes are IN v5/v6 and the 2067 still happens on
 * completing sales — and only the 2067 is reported now, not the 517 or the
 * nested-transaction error — so the batch-4 diagnosis was incomplete. A 2067
 * that happens on completing sales points to a DETERMINISTIC mechanism in
 * the sale path itself, not a race and not random-v4 collision.
 *
 * This sim drives the REAL sale statement construction (the exact INSERT
 * strings from src/modules/pos/POSCart.tsx completeSale, the real stockOut
 * from src/lib/stock.ts, the real injectUuid from src/lib/outbox.ts, the
 * real pgToSqlite from src/lib/localDb.ts) through a faithful mirror of
 * dbTransaction's local path, for a realistic cart — and checks whether a
 * normal multi-line sale can produce a duplicate order_items uuid.
 *
 * Run:  node --experimental-strip-types server/sim_sale_2067_deterministic.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  ensureLocalSchema,
  pgToSqlite,
} from '../src/lib/localDb.ts';
import { injectUuid } from '../src/lib/outbox.ts';
import { SYNC_TABLES } from '../src/lib/sync.ts';
import { stockOut } from '../src/lib/stock.ts';
import { newUuid } from '../src/lib/uuid.ts';
import { packLitres } from '../src/lib/units.ts';

const raw = new DatabaseSync(':memory:');

// Same adapter as sim_windows_login.js / sim_sale_duplicate_uuid.js:
// node:sqlite binds anonymous placeholders, while the Tauri plugin the app
// ships with understands $1.
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
// Mirrors dbExecute's local path (src/lib/db.ts): injectUuid, then
// RETURNING via select, else execute.
function runExecute(sql, params = []) {
  const inj = injectUuid(sql, params, SYNC_TABLES);
  const finalSql = inj ? inj.sql : sql;
  const finalParams = inj ? inj.params : params;
  const b = bind(finalSql, finalParams);
  if (/\breturning\b/i.test(finalSql)) {
    return raw.prepare(b.sql).all(...b.params);
  }
  raw.prepare(b.sql).run(...b.params);
  return [];
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

// leftoverLitres, replicated from POSCart.tsx (that module imports db.ts,
// which reads import.meta.env and cannot load under plain node — the formula
// is pack - capacity, 0 when the capacity is unknown or meets the pack).
function leftoverLitres(item) {
  const pack = packLitres(item.product);
  const cap = item.capacity ?? 0;
  if (pack <= 0 || cap <= 0 || cap >= pack) return 0;
  return Math.round((pack - cap) * 1000) / 1000;
}

// The exact completeSale statement construction (POSCart.tsx), for a cart
// of CartItem-shaped lines. The INSERT strings are copied verbatim; the
// stock ledger goes through the real stockOut().
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
      statements.push({ sql: "UPDATE containers SET remaining_volume = remaining_volume - $1, status = CASE WHEN remaining_volume - $1 <= 0 THEN 'empty' ELSE 'opened' END WHERE id = $2", params: [item.qty, item.container_id] });
      statements.push({ sql: 'INSERT INTO container_splits (container_id, sold_qty, order_id) VALUES ($1, $2, $3)', params: [item.container_id, item.qty, oid] });
    }
    if (item.kind === 'used_oil') {
      statements.push({ sql: 'UPDATE used_oil_drum SET current_litres = current_litres + $1 WHERE id = 1', params: [item.qty] });
      statements.push({ sql: 'INSERT INTO used_oil_log (drum_id, litres, type, source_order_id) VALUES (1, $1, \'added\', $2)', params: [item.qty, oid] });
    }
  }
  if (total > 0) {
    statements.push({ sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [total, paymentAccountId] });
    statements.push({ sql: 'INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1, $2, \'in\', $3)', params: [paymentAccountId, total, `Order #${oid}`] });
  }
  if (customerId) {
    statements.push({ sql: 'UPDATE customers SET last_visit_at = NOW() WHERE id = $1', params: [customerId] });
  }
  return statements;
}

function nextOid() {
  return Number(run('SELECT COALESCE(MAX(id), 0) + 1 AS oid FROM orders')[0].oid);
}

function assertUuidsDistinct(orderId, label) {
  const rows = run('SELECT id, uuid FROM order_items WHERE order_id = ?', [orderId]);
  assert(rows.length > 0, label + ': no order_items rows for order ' + orderId);
  const uuids = rows.map((r) => r.uuid);
  assert(uuids.every((u) => typeof u === 'string' && u.length > 0), label + ': every line must carry a uuid, got ' + JSON.stringify(uuids));
  assert(new Set(uuids).size === uuids.length, label + ': uuids must be distinct, got ' + JSON.stringify(uuids));
  return rows.length;
}

console.log('\nDeterministic 2067 on completing sales (reported 2026-11-25)');

await ensureLocalSchema(db);

// ── Seed: the shop the realistic sale needs ─────────────────────────────
run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (1, 1, 'GTX 4L', '4L', 4000, 4000, 3600, 10, 10, 1)");
run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (2, 1, 'Engine Oil 1L', '1L', 900, 900, 800, 10, 20, 1)");
run("INSERT INTO services (id, shop_id, name, price, active) VALUES (1, 1, 'Oil Change', 500, 1)");
run("INSERT INTO customers (id, shop_id, name, phone, customer_type) VALUES (3, 1, 'Ahmed Raza', '03001234567', 'walking')");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (5, 1, 1, 4, 2.5, 'opened', 1)");

const prodA = { id: 1, name: 'GTX 4L', packing: '4L' };
const prodB = { id: 2, name: 'Engine Oil 1L', packing: '1L' };

// A realistic till sale: 4L bottle billed by capacity (3.5L into the engine,
// 0.5L back on the shelf), a second product x2, a 0.5L draw from an opened
// container, a service, and 5L of used oil — with a vehicle on the ticket.
function realisticCart() {
  return [
    { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 3500, line_total: 3500, product: prodA, capacity: 3.5, billByCapacity: true, leftoverToContainers: true },
    { kind: 'product', ref_id: 2, name: 'Engine Oil 1L', qty: 2, unit_price: 900, line_total: 1800, product: prodB },
    { kind: 'partial_container', ref_id: 5, name: 'GTX 4L (2.5L left)', qty: 0.5, unit_price: 1000, line_total: 500, container_id: 5, max_qty: 2.5 },
    { kind: 'service', ref_id: 1, name: 'Oil Change', qty: 1, unit_price: 500, line_total: 500 },
    { kind: 'used_oil', ref_id: 1, name: 'Used Oil (drop-off)', qty: 5, unit_price: 0, line_total: 0 },
  ];
}

const TOTAL = 3500 + 1800 + 500 + 500; // 6300

// The vehicle pre-step (completeSale, before the transaction): INSERT ...
// RETURNING id through the dbExecute path.
function upsertVehicle() {
  const rows = runExecute(
    'INSERT INTO vehicles (customer_id, registration, make, model, model_year, color, condition, mileage, oil_capacity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [3, 'ABC-123', 'Toyota', 'Corolla', '2019', 'White', 'Good', 45000, 3.5]
  );
  return rows[0]?.id ?? null;
}

// ── 1. The realistic multi-line sale ─────────────────────────────────────
check('a realistic 5-line sale commits with distinct fresh uuids on every line', () => {
  const oid = nextOid();
  const vehicleId = upsertVehicle();
  const stmts = buildSaleStatements(oid, realisticCart(), 3, 1, 1, TOTAL, 45000, '', vehicleId);
  runSaleTx(stmts);
  assert(Number(run('SELECT COUNT(*) AS c FROM orders WHERE id = ?', [oid])[0].c) === 1, 'the order must land');
  const n = assertUuidsDistinct(oid, 'realistic sale');
  assert(n === 5, 'five order_items lines expected, got ' + n);
});

// ── 2. The same cart again, fresh oid — the next customer ────────────────
check('the same cart a second time (fresh oid) also commits, no 2067', () => {
  const oid = nextOid();
  const stmts = buildSaleStatements(oid, realisticCart(), 3, 1, 1, TOTAL, 45000, '', null);
  runSaleTx(stmts);
  assertUuidsDistinct(oid, 'second sale');
});

// ── 3. Twenty sales in a row, same shapes ───────────────────────────────
check('twenty sales in a row commit with globally distinct order_items uuids', () => {
  for (let i = 0; i < 20; i++) {
    const oid = nextOid();
    runSaleTx(buildSaleStatements(oid, realisticCart(), 3, 1, 1, TOTAL, 45000, '', null));
  }
  const dupes = run('SELECT uuid, COUNT(*) AS c FROM order_items WHERE uuid IS NOT NULL GROUP BY uuid HAVING c > 1');
  assert(dupes.length === 0, 'no uuid may repeat across 22 sales, got ' + JSON.stringify(dupes));
});

// ── 4. The same product twice in one cart ────────────────────────────────
check('a cart with the same product on two lines commits with distinct uuids', () => {
  const oid = nextOid();
  const cart = [
    { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
    { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
  ];
  runSaleTx(buildSaleStatements(oid, cart, 3, 1, 1, 8000, 0, '', null));
  assertUuidsDistinct(oid, 'same-product-twice sale');
});

// ── 5. The customer right panel after a successful sale ──────────────────
// The panel query in POS.tsx is LIMIT 10, newest first — assert it returns
// the newest ten, and the total count separately.
check('the customer panel queries return the completed sale (recent orders visible)', () => {
  const orders = run(
    `SELECT o.id, o.total, o.created_at FROM orders o WHERE o.customer_id = $1 AND o.status = 'completed' ORDER BY o.created_at DESC, o.id DESC LIMIT 10`,
    [3]
  );
  assert(orders.length === 10, 'the panel must list the newest ten completed sales, got ' + orders.length);
  const totalOrders = Number(run(`SELECT COUNT(*) AS c FROM orders WHERE customer_id = $1 AND status = 'completed'`, [3])[0].c);
  assert(totalOrders >= 22, 'the customer must have at least 22 completed sales in total, got ' + totalOrders);
  const recentLines = run(
    `SELECT oi.ref_id, oi.product_name, oi.unit_price, oi.qty, oi.capacity, oi.billed_by_capacity,
            o.id AS order_id, o.created_at
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.customer_id = $1 AND o.status = 'completed' AND oi.kind = 'product'
      ORDER BY o.created_at DESC, oi.id DESC LIMIT 60`,
    [3]
  );
  assert(recentLines.length > 0, 'the panel must list recent product lines');
  assert(recentLines.some((r) => r.product_name === 'GTX 4L'), 'the GTX line must be among them');
});

// ── 6. The old double-submit shape still fails loudly, on orders.id ─────
check('re-running the same statement array still fails on orders.id, not silently', () => {
  const oid = nextOid();
  const stmts = buildSaleStatements(oid, realisticCart(), 3, 1, 1, TOTAL, 45000, '', null);
  runSaleTx(stmts);
  assertThrows(
    () => runSaleTx(stmts),
    /UNIQUE constraint failed: orders\.id/,
    're-running the same array must fail on the frozen oid'
  );
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
