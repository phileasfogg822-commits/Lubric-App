/**
 * Pool-split atomicity + customer-panel history — the 2026-11-25 reports.
 *
 * TWO facts from Umar, both on the CURRENT head (v6, eec9a3b — confirmed
 * installed 2026-11-25 ~14:59 PKT, version visible):
 *
 *  (1) "i think the stock is getting lower each time, even the error was
 *      there": every failed sale attempt DECREMENTS stock while the order
 *      fails with 2067. The sale is NOT atomic — the stock update commits
 *      even when the order_items insert fails.
 *  (2) A customer with TEN transactions shows NO history on the sale page's
 *      right panel. Transactions exist; the panel query is broken on its own.
 *
 * ROOT CAUSE (1) — the driver, not the sale code. The app's local SQLite is
 * @tauri-apps/plugin-sql 2.4.0, and src-tauri/Cargo.lock proves it is
 * sqlx-sqlite 0.8.6 (7 sqlx crates, 0 rusqlite). The plugin opens the
 * database with `Pool::connect`: a sqlx pool of up to TEN connections, and
 * runs every `execute` / `select` of the webview as a fresh acquire from
 * it. There is NO JavaScript transaction primitive. So dbTransaction's
 * `BEGIN` / statements / `COMMIT` — each a separate Tauri invoke — can land
 * on DIFFERENT pooled connections: BEGIN on one, the writes on others
 * (each auto-committing), COMMIT on yet another (a no-op there). A failure
 * mid-sale leaves the earlier writes committed — stock down, no order —
 * and the ROLLBACK lands on a connection with no transaction, so the
 * transaction stranded on the first connection stays open (a permanent
 * write lock until the app restarts: the 517) and the next BEGIN on it
 * fails with "cannot start a transaction within a transaction". sqlx
 * returns a connection to its pool through a spawned task, so even
 * back-to-back awaits from one transaction can find no idle connection
 * and open a second one — the split needs no concurrent operation at all.
 * (Proven the same way in another Tauri app — Simpl-Resultat, Forgejo,
 * `db_pool_commands.rs` / ADR 0027 — which fixed it with a FIFO lock in
 * db.ts AND a single-connection pool swap in Rust.)
 *
 * THE FIX (this batch): (a) Rust: `use_single_connection_pool` replaces
 * the plugin's pool with ONE connection (idle_timeout(None) +
 * max_lifetime(None) — sqlx would otherwise close the single connection
 * idle 10 minutes / older than 30 minutes, cutting a transaction as
 * surely as a second one), invoked from getLocal() right after
 * Database.load, before any statement; (b) JS: a FIFO mutex in db.ts
 * serialises every local operation, so two transactions can never
 * interleave on that one connection (without it, a second BEGIN on the
 * single connection would be "cannot start a transaction within a
 * transaction"). Together they make a sale ONE real transaction: any
 * failure rolls everything back.
 *
 * ROOT CAUSE (2) — the panel query itself. POS.tsx loadHistory runs
 * `SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = $1 AND
 * status = 'completed'`. pgToSqlite strips `::date|text|numeric|double
 * precision|integer|real|timestamp` — `::int` is NOT in that list, so in
 * local (SQLite) mode the query throws "near ':' syntax error", the catch
 * in loadHistory sets the panel to EMPTY orders, and a customer with ten
 * transactions shows no history. The orders query itself is fine; the
 * count query poisons the whole load. Second panel gap: handleComplete
 * never reloads history after a successful sale, so the panel goes stale
 * even when the sale commits.
 *
 * THE 2067 ITSELF: the sale shapes below (single-item, multi-item, same
 * product twice, container line, retry after a failed attempt) run through
 * the pool model WITHOUT a forced duplicate and NONE throws 2067 — the
 * statement list generates fresh uuids per execution (proven by
 * sim_sale_2067_deterministic.js 5/6 → 6/6 after its check-5 fix). So the
 * 2067 needs a uuid that ALREADY sits in the table (pre-existing state —
 * the batch-4 patch repairs it at launch) — and with the sale atomic, a
 * failure can no longer leave a half-committed order behind for a retry
 * to trip over. The forced-duplicate checks below prove the atomicity
 * either way: the same 2067 leaks stock on the pool model and leaves
 * stock untouched on the fixed model.
 *
 * HOW THIS SIM MODELS THE DRIVER: node:sqlite connections to ONE temp
 * file. The pool model is 3 connections, round-robin per invoke — a
 * DETERMINISTIC split (every invoke on a different connection). The real
 * pool splits intermittently by timing, not every time; round-robin shows
 * the CONSEQUENCE of a split, which is what the user experiences. The
 * fixed model is ONE connection with sequential execution — exactly what
 * the single-connection pool + FIFO give the app. The source checks pin
 * the fix in the repo (Rust swap, FIFO, panel SQL, history reload); the
 * model checks pin the mechanism.
 *
 * Run:  node --experimental-strip-types server/sim_sale_pool_atomicity.js
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ensureLocalSchema,
  pgToSqlite,
} from '../src/lib/localDb.ts';
import { injectUuid } from '../src/lib/outbox.ts';
import { SYNC_TABLES } from '../src/lib/sync.ts';
import { stockOut } from '../src/lib/stock.ts';
import { newUuid } from '../src/lib/uuid.ts';
import { packLitres } from '../src/lib/units.ts';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lubric-pool-sim-'));
const DB_FILE = path.join(DIR, 'pool.db');

// ── Binding (same adapter as the other sims) ────────────────────────────
// node:sqlite binds anonymous placeholders, while the Tauri plugin
// understands $1. injectUuid appends a literal `?` for the fresh uuid,
// which binds AFTER the highest $n.
function bind(sql, params = []) {
  const sqlite = pgToSqlite(sql);
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
function execOn(raw, sql, params = []) {
  const b = bind(sql, params);
  // No params: exec() runs EVERY statement in the string — the schema DDL
  // (LOCAL_SCHEMA_*) packs several CREATE TABLEs per string, and prepare()
  // would silently run only the first. With params, the statement is
  // single, so prepare().run() binds them.
  if (b.params.length === 0) raw.exec(b.sql);
  else raw.prepare(b.sql).run(...b.params);
}
function selectOn(raw, sql, params = []) {
  const b = bind(sql, params);
  return raw.prepare(b.sql).all(...b.params);
}

// ── The two driver models ───────────────────────────────────────────────
// POOL: three connections to the same file — the plugin's default sqlx
// pool (up to ten, opened lazily) in a split. Transaction-control
// statements (BEGIN/COMMIT/ROLLBACK) always land on conn 0; data
// statements round-robin across conn 1 and 2. That is the split that
// matters: the BEGIN opens a transaction on one connection while every
// data statement auto-commits on others, and the COMMIT is a no-op on
// the connection that opened the transaction. Routing the control
// statements to one connection also keeps the data statements from
// contending with each other (each autocommit releases its lock before
// the next runs), so a split sale runs to its failure point instead of
// dying on SQLITE_BUSY first — the leak, not the lock, is what this
// model proves. (The lock itself is check D, the stranded transaction
// check E.)
const POOL_SIZE = 3;
const poolConns = Array.from({ length: POOL_SIZE }, (_, i) => {
  const c = new DatabaseSync(DB_FILE);
  // v5 reality: the batch-4 busy_timeout was set on the ONE connection
  // getLocal's load happened to use; the pool connections opened later
  // never got it. Conn 0 is the loaded one (5 s); the rest time out at 0.
  c.exec(`PRAGMA busy_timeout = ${i === 0 ? 5000 : 0}`);
  return c;
});
let poolDataNext = 0;
function poolAcquire(sql) {
  const head = String(sql).trim().toUpperCase();
  if (head === 'BEGIN' || head === 'COMMIT' || head === 'ROLLBACK') return poolConns[0];
  const c = poolConns[1 + (poolDataNext % (POOL_SIZE - 1))];
  poolDataNext += 1;
  return c;
}
const poolDb = {
  execute: async (sql, params = []) => { execOn(poolAcquire(sql), sql, params); },
  select: async (sql, params = []) => selectOn(poolAcquire(sql), sql, params),
};
// Roll back any transaction stranded on a pool connection (or the single
// one) — a ROLLBACK with no open transaction is a no-op in SQLite. Keeps
// one check's stranded transaction from poisoning the next.
function resetTxState() {
  for (const c of [...poolConns, singleConn]) { try { c.exec('ROLLBACK'); } catch { /* no transaction open */ } }
}

// FIXED: one connection, sequential execution — the single-connection pool
// (Rust, max_connections(1), never closed) plus the JS FIFO mutex, which
// serialises every local operation so no two transactions interleave.
const singleConn = new DatabaseSync(DB_FILE);
singleConn.exec('PRAGMA busy_timeout = 5000');
const singleDb = {
  execute: async (sql, params = []) => { execOn(singleConn, sql, params); },
  select: async (sql, params = []) => selectOn(singleConn, sql, params),
};

// Mirrors dbExecute's local path (src/lib/db.ts): injectUuid, then
// RETURNING via select, else execute. `db` is either driver model.
async function runExecuteOn(db, sql, params = []) {
  const inj = injectUuid(sql, params, SYNC_TABLES);
  const finalSql = inj ? inj.sql : sql;
  const finalParams = inj ? inj.params : params;
  if (/\breturning\b/i.test(finalSql)) {
    return db.select(pgToSqlite(finalSql), finalParams);
  }
  await db.execute(pgToSqlite(finalSql), finalParams);
  return [];
}

// Mirrors dbTransaction's local path (src/lib/db.ts): one BEGIN..COMMIT,
// injectUuid per statement at execution time, ROLLBACK on error. `db` is
// either driver model. `forceUuid` optionally replaces the injected uuid
// of the Nth order_items INSERT (0-based) with a known duplicate —
// simulating a uuid that already sits in the table (the user's 2067).
async function runTxOn(db, statements, forceUuid = null) {
  await db.execute('BEGIN');
  try {
    let itemInserts = 0;
    for (const st of statements) {
      const p = st.params ?? [];
      const inj = injectUuid(st.sql, p, SYNC_TABLES);
      let s = inj ? inj.sql : st.sql;
      let pp = inj ? inj.params : p;
      if (forceUuid && /INSERT INTO order_items/i.test(s)) {
        if (itemInserts === forceUuid.index) {
          pp = [...pp];
          pp[pp.length - 1] = forceUuid.uuid;
        }
        itemInserts += 1;
      }
      if (/\breturning\b/i.test(s)) {
        await db.select(pgToSqlite(s), pp);
      } else {
        await db.execute(pgToSqlite(s), pp);
      }
    }
    await db.execute('COMMIT');
  } catch (e) {
    try { await db.execute('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => { ok++; console.log('  PASS ' + title); }, (e) => { console.log('  FAIL ' + title + ': ' + e.message); });
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}
async function checkAsync(title, fn) {
  total++;
  try { await fn(); ok++; console.log('  PASS ' + title); }
  catch (e) { console.log('  FAIL ' + title + ': ' + e.message); }
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
async function assertThrowsAsync(fn, re, m) {
  let got = null;
  try { await fn(); } catch (e) { got = e; }
  assert(got, (m || 'expected a throw') + ' — nothing threw');
  assert(re.test(got.message), (m || 'wrong error') + ' — got: ' + got.message);
}

// leftoverLitres, replicated from POSCart.tsx (same note as the 2067 sim).
function leftoverLitres(item) {
  const pack = packLitres(item.product);
  const cap = item.capacity ?? 0;
  if (pack <= 0 || cap <= 0 || cap >= pack) return 0;
  return Math.round((pack - cap) * 1000) / 1000;
}

// The exact completeSale statement construction (POSCart.tsx) — copied
// verbatim from sim_sale_2067_deterministic.js, same cart shapes.
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
  return Number(selectOn(singleConn, 'SELECT COALESCE(MAX(id), 0) + 1 AS oid FROM orders')[0].oid);
}
function stockQty(productId) {
  return Number(selectOn(singleConn, 'SELECT stock_qty FROM products WHERE id = ?', [productId])[0].stock_qty);
}
function stockLevelQty(productId) {
  const rows = selectOn(singleConn, 'SELECT qty FROM stock_levels WHERE warehouse_id = 1 AND product_id = ?', [productId]);
  return rows.length ? Number(rows[0].qty) : 0;
}

console.log('\nPool-split atomicity + customer-panel history (reported 2026-11-25)');

await ensureLocalSchema(singleDb);

// ── Seed: the shop the realistic sale needs ─────────────────────────────
execOn(singleConn, "INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (1, 1, 'GTX 4L', '4L', 4000, 4000, 3600, 10, 10, 1)");
execOn(singleConn, "INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (2, 1, 'Engine Oil 1L', '1L', 900, 900, 800, 10, 20, 1)");
execOn(singleConn, "INSERT INTO services (id, shop_id, name, price, active) VALUES (1, 1, 'Oil Change', 500, 1)");
execOn(singleConn, "INSERT INTO customers (id, shop_id, name, phone, customer_type) VALUES (3, 1, 'Ahmed Raza', '03001234567', 'walking')");
execOn(singleConn, "INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (5, 1, 1, 4, 2.5, 'opened', 1)");
execOn(singleConn, "INSERT INTO stock_levels (shop_id, warehouse_id, product_id, qty) VALUES (1, 1, 1, 10)");
execOn(singleConn, "INSERT INTO stock_levels (shop_id, warehouse_id, product_id, qty) VALUES (1, 1, 2, 20)");

const prodA = { id: 1, name: 'GTX 4L', packing: '4L' };
const prodB = { id: 2, name: 'Engine Oil 1L', packing: '1L' };
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

// A first sale that commits, so the forced duplicate below is a REAL row
// from a REAL sale (not an invented uuid): its first line's uuid.
const firstOid = nextOid();
await runTxOn(singleDb, buildSaleStatements(firstOid, realisticCart(), 3, 1, 1, TOTAL, 45000, '', null));
const dupUuid = selectOn(singleConn, 'SELECT uuid FROM order_items WHERE order_id = ? ORDER BY id LIMIT 1', [firstOid])[0].uuid;
assert(typeof dupUuid === 'string' && dupUuid.length > 0, 'the first sale must leave a real uuid to collide with');

// ── A. POOL MODEL — the stock leak (the bug, reproduced) ─────────────────
// A sale that fails with the exact 2067 on the pool model must leave stock
// DOWN and a half-committed order behind — Umar's "stock is getting lower
// each time, even the error was there".
await checkAsync('POOL: a sale failing with 2067 leaves stock DOWN and a half-committed order (the leak)', async () => {
  const beforeA = stockQty(1), beforeB = stockQty(2);
  const beforeLevelA = stockLevelQty(1), beforeLevelB = stockLevelQty(2);
  const oid = nextOid();
  const stmts = buildSaleStatements(oid, realisticCart(), 3, 1, 1, TOTAL, 45000, '', null);
  await assertThrowsAsync(
    () => runTxOn(poolDb, stmts, { index: 1, uuid: dupUuid }),
    /UNIQUE constraint failed: order_items\.uuid/,
    'the forced duplicate must throw the exact 2067'
  );
  assert(stockQty(1) < beforeA || stockQty(2) < beforeB, `stock must have leaked down (was ${beforeA}/${beforeB}, now ${stockQty(1)}/${stockQty(2)})`);
  assert(stockLevelQty(1) < beforeLevelA || stockLevelQty(2) < beforeLevelB, `stock_levels must have leaked down (was ${beforeLevelA}/${beforeLevelB}, now ${stockLevelQty(1)}/${stockLevelQty(2)})`);
  const orderRows = Number(selectOn(singleConn, 'SELECT COUNT(*) AS c FROM orders WHERE id = ?', [oid])[0].c);
  assert(orderRows === 1, 'the failed sale must have left its half-committed order behind, got ' + orderRows);
});

// ── B. FIXED MODEL — atomicity (the fix, proven) ─────────────────────────
resetTxState();
// The SAME forced 2067 on one connection must leave stock UNCHANGED and
// no trace of the order — the whole sale is one transaction.
await checkAsync('FIXED: the same sale failing with 2067 leaves stock UNCHANGED and no order', async () => {
  const beforeA = stockQty(1), beforeB = stockQty(2);
  const beforeLevelA = stockLevelQty(1), beforeLevelB = stockLevelQty(2);
  const oid = nextOid();
  const stmts = buildSaleStatements(oid, realisticCart(), 3, 1, 1, TOTAL, 45000, '', null);
  await assertThrowsAsync(
    () => runTxOn(singleDb, stmts, { index: 1, uuid: dupUuid }),
    /UNIQUE constraint failed: order_items\.uuid/,
    'the forced duplicate must throw the exact 2067'
  );
  assert(stockQty(1) === beforeA && stockQty(2) === beforeB, `stock must be unchanged (was ${beforeA}/${beforeB}, now ${stockQty(1)}/${stockQty(2)})`);
  assert(stockLevelQty(1) === beforeLevelA && stockLevelQty(2) === beforeLevelB, `stock_levels must be unchanged (was ${beforeLevelA}/${beforeLevelB}, now ${stockLevelQty(1)}/${stockLevelQty(2)})`);
  const orderRows = Number(selectOn(singleConn, 'SELECT COUNT(*) AS c FROM orders WHERE id = ?', [oid])[0].c);
  assert(orderRows === 0, 'no order row may survive a rolled-back sale, got ' + orderRows);
  const itemRows = Number(selectOn(singleConn, 'SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?', [oid])[0].c);
  assert(itemRows === 0, 'no order_items rows may survive a rolled-back sale, got ' + itemRows);
});

// A successful sale on the fixed model decrements stock exactly once.
await checkAsync('FIXED: a successful sale decrements stock exactly once', async () => {
  const beforeA = stockQty(1), beforeB = stockQty(2);
  const beforeLevelA = stockLevelQty(1), beforeLevelB = stockLevelQty(2);
  const oid = nextOid();
  await runTxOn(singleDb, buildSaleStatements(oid, realisticCart(), 3, 1, 1, TOTAL, 45000, '', null));
  assert(stockQty(1) === beforeA - 1, `GTX stock must drop by exactly 1 (was ${beforeA}, now ${stockQty(1)})`);
  assert(stockQty(2) === beforeB - 2, `1L stock must drop by exactly 2 (was ${beforeB}, now ${stockQty(2)})`);
  assert(stockLevelQty(1) === beforeLevelA - 1 && stockLevelQty(2) === beforeLevelB - 2, 'stock_levels must drop by exactly the sold quantities');
});

// ── C. SALE SHAPES on the pool model — no 2067 from the sale path ───────
// Fresh uuids per execution: none of these shapes throws 2067 on its own,
// so the 2067 needs a uuid that already sits in the table.
await checkAsync('POOL: single-item, multi-item, same-product-twice and container sales commit with no 2067', async () => {
  const shapes = [
    [{ kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA }],
    realisticCart(),
    [
      { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
      { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
    ],
    [{ kind: 'partial_container', ref_id: 5, name: 'GTX 4L (2.5L left)', qty: 0.5, unit_price: 1000, line_total: 500, container_id: 5, max_qty: 2.5 }],
  ];
  for (const cart of shapes) {
    const oid = nextOid();
    const t = cart.reduce((s, it) => s + it.line_total, 0);
    await runTxOn(poolDb, buildSaleStatements(oid, cart, 3, 1, 1, t, 0, '', null));
    const n = Number(selectOn(singleConn, 'SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?', [oid])[0].c);
    assert(n === cart.length, `shape must land all ${cart.length} lines, got ${n}`);
  }
  const dupes = selectOn(singleConn, 'SELECT uuid, COUNT(*) AS c FROM order_items WHERE uuid IS NOT NULL GROUP BY uuid HAVING c > 1');
  assert(dupes.length === 0, 'no uuid may repeat across all pool-model sales, got ' + JSON.stringify(dupes));
});

// ── D. 517 — two pooled connections, one holding the write lock ──────────
resetTxState();
check('POOL: a write on a second connection while the first holds the lock fails with 517', () => {
  const a = poolConns[0], b = poolConns[1];
  a.exec('BEGIN IMMEDIATE');
  try {
    assertThrows(
      () => b.prepare('UPDATE products SET stock_qty = stock_qty WHERE id = 1').run(),
      /database is locked/,
      'the second connection must fail with SQLITE_BUSY (517)'
    );
  } finally {
    a.exec('ROLLBACK');
  }
});
check('FIXED: the same write serialised on one connection succeeds', () => {
  singleConn.prepare('UPDATE products SET stock_qty = stock_qty WHERE id = 1').run();
});

// ── E. NESTED BEGIN — a BEGIN landing on a connection with an open tx ───
resetTxState();
check('POOL: a second BEGIN on a connection with an open transaction fails', () => {
  const a = poolConns[0];
  a.exec('BEGIN');
  try {
    assertThrows(
      () => a.exec('BEGIN'),
      /cannot start a transaction within a transaction/,
      'the nested BEGIN must fail with the reported error'
    );
  } finally {
    a.exec('ROLLBACK');
  }
});
await checkAsync('FIXED: two transactions serialised (FIFO) both commit', async () => {
  const oid1 = nextOid();
  await runTxOn(singleDb, buildSaleStatements(oid1, [{ kind: 'product', ref_id: 2, name: 'Engine Oil 1L', qty: 1, unit_price: 900, line_total: 900, product: prodB }], 3, 1, 1, 900, 0, '', null));
  const oid2 = nextOid();
  await runTxOn(singleDb, buildSaleStatements(oid2, [{ kind: 'product', ref_id: 2, name: 'Engine Oil 1L', qty: 1, unit_price: 900, line_total: 900, product: prodB }], 3, 1, 1, 900, 0, '', null));
  const n = Number(selectOn(singleConn, 'SELECT COUNT(*) AS c FROM orders WHERE id IN (?, ?)', [oid1, oid2])[0].c);
  assert(n === 2, 'both serialised transactions must commit, got ' + n);
});

// ── F. PANEL — the ::int bug (reproduced) and the fix (proven) ───────────
// Ten completed orders for customer 3, the panel's customer: the exact
// queries POS.tsx loadHistory runs, in its order, through the same
// pgToSqlite + bind the app uses — and the same catch that empties the
// panel on any failure.
for (let i = 0; i < 10; i++) {
  const oid = nextOid();
  execOn(singleConn, `INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, vehicle_id, mileage, notes, created_at) VALUES (${oid}, 1, 3, 1, 1000, 1000, 1, 'cash', 'completed', NULL, 0, '', '2026-11-2${i % 10} 10:00:00')`);
  execOn(singleConn, `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, uuid) VALUES (${oid}, 'product', 1, 'GTX 4L', 1, 1000, 1000, '${newUuid()}')`);
}
const PANEL_ORDERS = `SELECT o.id, o.total, o.created_at, o.status, o.mileage, o.notes, o.vehicle_id, v.registration, v.make, v.model, v.model_year, v.color, v."condition" AS vehicle_condition, COUNT(oi.id) as item_count FROM orders o LEFT JOIN order_items oi ON o.id = oi.order_id LEFT JOIN vehicles v ON v.id = o.vehicle_id WHERE o.customer_id = $1 GROUP BY o.id, v.id ORDER BY o.created_at DESC LIMIT 10`;
const PANEL_SPENT = `SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE customer_id = $1 AND status = 'completed'`;
const PANEL_COUNT_OLD = `SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = $1 AND status = 'completed'`;
const PANEL_COUNT_FIXED = `SELECT COUNT(*) AS n FROM orders WHERE customer_id = $1 AND status = 'completed'`;
const PANEL_LINES = `SELECT oi.ref_id, oi.product_name, oi.unit_price, oi.qty,
                oi.capacity, oi.billed_by_capacity,
                o.id AS order_id, o.created_at
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE o.customer_id = $1
            AND o.status = 'completed'
            AND oi.kind = 'product'
          ORDER BY o.created_at DESC, oi.id DESC
          LIMIT 60`;
function runPanelQuery(sql) {
  const b = bind(sql, [3]);
  return singleConn.prepare(b.sql).all(...b.params);
}
check('PANEL (old SQL): COUNT(*)::int throws in SQLite, so loadHistory empties the panel', () => {
  const orders = runPanelQuery(PANEL_ORDERS);
  assert(orders.length === 10, 'the orders query itself returns all ten, got ' + orders.length);
  let panelOrders = orders;
  try {
    runPanelQuery(PANEL_SPENT);
    runPanelQuery(PANEL_COUNT_OLD);
    runPanelQuery(PANEL_LINES);
  } catch (e) {
    // The catch in loadHistory: every field the panel reads, emptied.
    assert(/unrecognized token|near ":"/.test(e.message), 'the old count query must fail on the :: cast, got: ' + e.message);
    panelOrders = [];
  }
  assert(panelOrders.length === 0, 'the catch leaves the panel with no orders — the reported bug');
});
check('PANEL (fixed SQL): COUNT(*) returns all ten orders, the right bills and the recent lines', () => {
  const orders = runPanelQuery(PANEL_ORDERS);
  assert(orders.length === 10, 'the panel must list the newest ten orders, got ' + orders.length);
  const expectedBills = Number(selectOn(singleConn, "SELECT COUNT(*) AS c FROM orders WHERE customer_id = 3 AND status = 'completed'")[0].c);
  assert(expectedBills >= 10, 'the seed must leave at least ten completed orders for the customer, got ' + expectedBills);
  const spent = runPanelQuery(PANEL_SPENT);
  const expectedSpent = Number(selectOn(singleConn, "SELECT COALESCE(SUM(total), 0) AS t FROM orders WHERE customer_id = 3 AND status = 'completed'")[0].t);
  assert(Number(spent[0].total) === expectedSpent, 'totalSpent must equal the sum of the completed orders, got ' + spent[0].total + ' vs ' + expectedSpent);
  const bills = runPanelQuery(PANEL_COUNT_FIXED);
  assert(Number(bills[0].n) === expectedBills, 'bills must equal the completed-order count ' + expectedBills + ', got ' + bills[0].n);
  const lines = runPanelQuery(PANEL_LINES);
  assert(lines.length > 0, 'recent product lines must be non-empty');
  assert(lines.some((r) => r.product_name === 'GTX 4L'), 'the GTX line must be among them');
});

// ── G. SOURCE CHECKS — the fix, pinned in the repo ───────────────────────
const POS_TSX = fs.readFileSync('src/modules/pos/POS.tsx', 'utf8');
const DB_TS = fs.readFileSync('src/lib/db.ts', 'utf8');
const DB_POOL_RS = fs.existsSync('src-tauri/src/db_pool.rs') ? fs.readFileSync('src-tauri/src/db_pool.rs', 'utf8') : '';
const LIB_RS = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
const CARGO_TOML = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const CAP_JSON = fs.readFileSync('src-tauri/capabilities/default.json', 'utf8');
const PERM_TOML = fs.existsSync('src-tauri/permissions/db-pool.toml') ? fs.readFileSync('src-tauri/permissions/db-pool.toml', 'utf8') : '';
check('SOURCE: POS.tsx no longer casts the panel count with ::int', () => {
  assert(!POS_TSX.includes('COUNT(*)::int'), 'POS.tsx must not contain COUNT(*)::int');
  assert(POS_TSX.includes('SELECT COUNT(*) AS n FROM orders WHERE customer_id'), 'POS.tsx must count bills with plain COUNT(*)');
});
check('SOURCE: handleComplete reloads the customer history after a successful sale', () => {
  assert(POS_TSX.includes('loadHistory(soldCustomer)'), 'handleComplete must call loadHistory(soldCustomer) after the sale commits');
});
check('SOURCE: db.ts serialises local operations through one FIFO chain', () => {
  assert(DB_TS.includes('runLocalSerialized'), 'db.ts must define runLocalSerialized');
  assert(DB_TS.includes('runLocalSerialized(async () =>'), 'dbSelect/dbExecute/dbTransaction must run their local path through it');
});
check('SOURCE: getLocal() swaps in the single-connection pool right after Database.load', () => {
  assert(DB_TS.includes('use_single_connection_pool'), 'db.ts must invoke use_single_connection_pool');
  assert(DB_TS.includes('sqlite:lubric.db'), 'the swap must target the same URL Database.load opened');
});
check('SOURCE: the Rust swap is one connection that sqlx never closes', () => {
  assert(DB_POOL_RS.includes('max_connections(1)'), 'db_pool.rs must cap the pool at one connection');
  assert(DB_POOL_RS.includes('idle_timeout(None)'), 'db_pool.rs must never idle-close the connection');
  assert(DB_POOL_RS.includes('max_lifetime(None)'), 'db_pool.rs must never lifetime-close the connection');
  assert(DB_POOL_RS.includes('DbPool::Sqlite'), 'db_pool.rs must replace the plugin Sqlite pool');
  assert(DB_POOL_RS.includes('use_single_connection_pool'), 'db_pool.rs must expose use_single_connection_pool');
});
check('SOURCE: lib.rs registers the swap command and Cargo.toml has sqlx', () => {
  assert(LIB_RS.includes('use_single_connection_pool'), 'lib.rs must register use_single_connection_pool in generate_handler');
  assert(LIB_RS.includes('mod db_pool'), 'lib.rs must declare mod db_pool');
  assert(/^sqlx\s*=/m.test(CARGO_TOML), 'Cargo.toml must depend on sqlx directly for the swap');
});
check('SOURCE: the main window is allowed to invoke the swap command', () => {
  assert(PERM_TOML.includes('use_single_connection_pool'), 'permissions/db-pool.toml must allow use_single_connection_pool');
  assert(CAP_JSON.includes('allow-use-single-connection-pool'), 'capabilities/default.json must grant allow-use-single-connection-pool');
});

console.log(`\n${ok}/${total} passed`);
for (const c of poolConns) { try { c.close(); } catch { /* ignore */ } }
try { singleConn.close(); } catch { /* ignore */ }
try { fs.unlinkSync(DB_FILE); fs.rmdirSync(DIR); } catch { /* temp dir stays */ }
if (ok !== total) process.exit(1);
