/**
 * Duplicate order_items.uuid (2067) and the missing previous data — the
 * 2026-11-24 reports "error returned from database: (code: 2067) UNIQUE
 * constraint failed: order_items.uuid" and "no previous data is shown".
 *
 * Mechanism, proved in the experiments before this sim was written:
 *   - UUIDs are random v4, so a collision is essentially impossible — a
 *     2067 means the SAME uuids were inserted twice. completeSale builds
 *     one statements array and dbTransaction executes it; injectUuid
 *     regenerates the orders/order_items uuids per EXECUTION, but the
 *     stockOut uuid is generated ONCE at statement-build time (newUuid()
 *     passed into stockOut), so it is frozen in the array. Re-executing
 *     the same array therefore collides — and the order id (oid, from
 *     nextval's MAX(id)+1) is frozen in the array too, so two concurrent
 *     completeSale calls that allocate the same oid collide on orders.id.
 *   - The cascade that hides the history: a database that already holds
 *     duplicate order_items uuids makes ensureLocalSchema fail at CREATE
 *     UNIQUE INDEX idx_order_items_uuid with exactly that 2067 — and
 *     because getLocal() throws, EVERY read fails, so SalesHistory shows
 *     its EmptyState and the POS history loader catches to empty orders.
 *     One bad duplicate takes the whole local database down with it.
 *
 * The fix:
 *   - localDb.ts patchOrderItemsUuidDuplicates, run in ensureLocalSchema
 *     right before the index: keep the lowest-id row per uuid (the original
 *     sale line), NULL the rest. Non-destructive — no sale history is lost
 *     — and NULLs are distinct under a unique index. The nulled rows cannot
 *     sync as new rows: the outbox triggers fire only WHEN NEW.uuid IS NOT
 *     NULL (outbox.ts).
 *   - POS.tsx handleComplete gains a synchronous submittingRef guard: the
 *     tx.busy state only disables the button after a re-render, so a fast
 *     double-click slipped through and submitted the same sale twice. The
 *     ref flips synchronously, so the second tap is refused before anything
 *     is submitted, and the next sale allocates a fresh oid.
 *
 * What is checked:
 *   1. RED: a DB holding duplicate order_items uuids fails the raw index
 *      creation with exactly "UNIQUE constraint failed: order_items.uuid",
 *      and a schema-init-then-read path throws with it — the history shows
 *      nothing. (This is the old ensureLocalSchema behaviour.)
 *   2. GREEN: the real ensureLocalSchema repairs that DB — the index is
 *      created, the original line keeps its uuid, the duplicate is NULLed,
 *      BOTH rows are still there, and the history SELECT returns them.
 *   3. GREEN: a subsequent sale succeeds on the repaired DB.
 *   4. Two sale batches with the same oid: the second fails with
 *      "UNIQUE constraint failed: orders.id" (the double-submit shape).
 *      The same two sales with fresh oids — what the ref guard makes
 *      happen — both succeed.
 *   5. Re-executing the same statements array fails loudly (orders.id);
 *      re-executing it with only a fresh oid fails on the frozen stockOut
 *      uuid — "UNIQUE constraint failed: stock_movements.uuid" (2067).
 *      A FRESH completeSale-style call after a rolled-back attempt succeeds.
 *   6. Guard model: a synchronous submitting flag refuses the second of
 *      two concurrent submits without executing it; source tie-in asserts
 *      POS.tsx carries submittingRef.
 *
 * Run:  node --experimental-strip-types sim_sale_duplicate_uuid.js
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  ensureLocalSchema,
  pgToSqlite,
  LOCAL_SCHEMA,
  LOCAL_SCHEMA_2,
} from '../src/lib/localDb.ts';
import { injectUuid } from '../src/lib/outbox.ts';
import { SYNC_TABLES } from '../src/lib/sync.ts';
import { stockOut } from '../src/lib/stock.ts';

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

// The exact completeSale statements for one product line
// (src/modules/pos/POSCart.tsx), with the stock ledger entries.
function saleStatements(oid, stockUuid) {
  return [
    {
      sql: `INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, vehicle_id, mileage, notes, created_at) VALUES ($1, 1, $2, $3, $4, $4, $5, 'cash', 'completed', $6, $7, $8, NOW())`,
      params: [oid, null, 1, 4000, 1, null, 0, ''],
    },
    {
      sql: `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      params: [oid, 'product', 1, 'GTX 4L', 1, 4000, 4000, null, 0, 0, 'customer', 0, 0],
    },
    ...stockOut(1, 1, 'sale', stockUuid, { table: 'orders', id: oid }),
  ];
}

console.log('\nDuplicate order_items.uuid (2067) + missing previous data');

// ── 1. RED: the 2067 cascade on a DB that already holds duplicates ───────
// Tables first (no unique uuid index yet — that is what ensureLocalSchema
// creates), then the duplicate: the same sale line inserted twice with the
// same uuid, as a double-submit leaves it.
raw.exec(LOCAL_SCHEMA);
raw.exec(LOCAL_SCHEMA_2);
run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status) VALUES (1, 1, NULL, 1, 4000, 4000, 1, 'cash', 'completed')");
run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, uuid) VALUES (1, 'product', 1, 'GTX 4L', 1, 4000, 4000, 'dup-uuid-1')");
run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, uuid) VALUES (1, 'product', 1, 'GTX 4L', 1, 4000, 4000, 'dup-uuid-1')");

check('RED: the raw index creation fails with exactly the reported 2067', () => {
  assertThrows(
    () => raw.exec('CREATE UNIQUE INDEX idx_order_items_uuid ON order_items(uuid)'),
    /UNIQUE constraint failed: order_items\.uuid/,
    'the duplicate DB must fail the index creation'
  );
});

check('RED: schema-init-then-read throws, so the history shows nothing', () => {
  // The old getLocal path: ensureLocalSchema throws on the index, so every
  // dbSelect/dbExecute/dbTransaction after it throws too — SalesHistory
  // gets no data (EmptyState) and the POS history loader catches to empty.
  const readHistoryOld = () => {
    raw.exec('CREATE UNIQUE INDEX idx_order_items_uuid ON order_items(uuid)');
    return raw.prepare('SELECT id FROM order_items ORDER BY id').all();
  };
  assertThrows(readHistoryOld, /UNIQUE constraint failed: order_items\.uuid/, 'the old read path must throw');
});

// ── 2. GREEN: the fixed schema init repairs the DB ───────────────────────
await checkAsync('GREEN: ensureLocalSchema repairs the duplicates and creates the index', async () => {
  await ensureLocalSchema(db);
  const idxs = run('PRAGMA index_list(order_items)').filter((ix) => ix.unique);
  const hit = idxs.some((ix) => run(`PRAGMA index_info(${ix.name})`).map((c) => c.name).join(',') === 'uuid');
  assert(hit, 'idx_order_items_uuid must exist after the repair');
});

check('GREEN: the original line keeps its uuid, the duplicate is NULLed, history intact', () => {
  const rows = run('SELECT id, uuid FROM order_items ORDER BY id');
  assert(rows.length === 2, 'both sale lines must still be there, got ' + rows.length);
  assert(rows[0].uuid === 'dup-uuid-1', 'the lowest-id row keeps the uuid, got ' + rows[0].uuid);
  assert(rows[1].uuid === null, 'the duplicate must be NULLed, got ' + rows[1].uuid);
  const history = run('SELECT id, product_name, qty, unit_price FROM order_items ORDER BY id');
  assert(history.length === 2, 'the history SELECT must return both lines');
});

// ── 3. GREEN: a subsequent sale succeeds on the repaired DB ──────────────
check('GREEN: a fresh sale succeeds on the repaired DB', () => {
  run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty) VALUES (1, 1, 'GTX 4L', '4L', 4000, 4000, 3600, 10, 10)");
  runSaleTx(saleStatements(2, 'uuid-fresh-1'));
  const line = run('SELECT uuid FROM order_items WHERE order_id = 2')[0];
  assert(line && line.uuid && line.uuid !== 'dup-uuid-1', 'the new line must carry a fresh uuid');
  assert(Number(run('SELECT stock_qty FROM products WHERE id = 1')[0].stock_qty) === 9, 'stock must move by the sale');
});

// ── 4. same oid twice: the double-submit shape ───────────────────────────
check('two sales with the same oid: the second fails on orders.id', () => {
  runSaleTx(saleStatements(101, 'uuid-b1'));
  assertThrows(
    () => runSaleTx(saleStatements(101, 'uuid-b2')),
    /UNIQUE constraint failed: orders\.id/,
    'the second sale with the same oid must fail'
  );
});

check('the same two sales with fresh oids both succeed (what the guard makes happen)', () => {
  runSaleTx(saleStatements(102, 'uuid-b3'));
  runSaleTx(saleStatements(103, 'uuid-b4'));
  assert(Number(run('SELECT COUNT(*) AS c FROM orders WHERE id IN (102, 103)')[0].c) === 2, 'both fresh-oid sales must land');
});

// ── 5. frozen-uuid re-execution ──────────────────────────────────────────
check('re-executing the same array fails loudly on the frozen oid', () => {
  const stmts = saleStatements(104, 'uuid-frozen');
  runSaleTx(stmts);
  assertThrows(
    () => runSaleTx(stmts),
    /UNIQUE constraint failed: orders\.id/,
    're-running the same array must fail, not double-insert'
  );
});

check('same array, fresh oid only: the frozen stockOut uuid fails with 2067', () => {
  // The ONLY value shared with the first execution is the stockOut uuid
  // (frozen at statement-build time); injectUuid regenerates the
  // orders/order_items uuids per execution, so the collision lands there.
  const retry = saleStatements(105, 'uuid-frozen');
  assertThrows(
    () => runSaleTx(retry),
    /UNIQUE constraint failed: stock_movements\.uuid/,
    'the frozen stockOut uuid must collide with 2067'
  );
});

check('a FRESH call after a rolled-back attempt succeeds', () => {
  // A failed sale rolls back, so its oid is free and its uuids were never
  // committed — a fresh completeSale-style call (fresh array, fresh uuids,
  // fresh oid) must land cleanly.
  const attempt = saleStatements(106, 'uuid-attempt');
  try { runSaleTx([...attempt, { sql: 'INSERT INTO no_such_table (id) VALUES (1)', params: [] }]); } catch { /* the sale rolled back */ }
  assert(Number(run('SELECT COUNT(*) AS c FROM orders WHERE id = 106')[0].c) === 0, 'the rolled-back attempt must leave nothing');
  runSaleTx(saleStatements(106, 'uuid-retry'));
  assert(Number(run('SELECT COUNT(*) AS c FROM orders WHERE id = 106')[0].c) === 1, 'the fresh retry must land');
});

// ── 6. the guard model + source tie-in ───────────────────────────────────
await checkAsync('guard model: the second of two concurrent submits is refused, not executed', async () => {
  let executions = 0;
  let submitting = false;
  async function submitOnce() {
    if (submitting) return 'refused';
    submitting = true;
    try {
      await new Promise((r) => setTimeout(r, 20));
      executions++;
      return 'submitted';
    } finally { submitting = false; }
  }
  const results = await Promise.all([submitOnce(), submitOnce()]);
  assert(results.includes('submitted') && results.includes('refused'), 'one must submit, one must be refused: ' + JSON.stringify(results));
  assert(executions === 1, 'the sale must execute exactly once, got ' + executions);
  // And the guard clears: a later submit works.
  assert((await submitOnce()) === 'submitted', 'the guard must clear after the sale finishes');
  assert(executions === 2, 'a later sale must execute');
});

check('source tie-in: POS.tsx carries the synchronous submittingRef guard', () => {
  const pos = readFileSync(new URL('../src/modules/pos/POS.tsx', import.meta.url), 'utf8');
  assert(pos.includes('submittingRef'), 'POS.tsx must declare submittingRef');
  assert(pos.includes('if (submittingRef.current) return;'), 'handleComplete must refuse while a sale is in flight');
  assert(pos.includes('submittingRef.current = false'), 'the guard must clear in the finally');
  const localDb = readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');
  assert(localDb.includes('patchOrderItemsUuidDuplicates'), 'localDb.ts must carry the dedupe repair');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
