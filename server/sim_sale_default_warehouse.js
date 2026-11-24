/**
 * Sale with no default warehouse — the Windows error of 2026-11-24.
 *
 * Completing a sale on the Windows app died with:
 *   "error returned from database: (code: 1299) NOT NULL constraint failed:
 *    stock_levels.warehouse_id"
 *
 * The sale passes no warehouse, so stock.ts resolves one in SQL with
 * COALESCE($n, (SELECT id FROM warehouses WHERE shop_id = ... AND
 * is_default AND active = 1 LIMIT 1)). But the local database's warehouses
 * table is EMPTY — LOCAL_SEED seeds the shop, accounts and the oil drum,
 * never a warehouse — so the fallback is NULL and the stock_levels INSERT
 * violates its NOT NULL warehouse_id. (The earlier ON CONFLICT failure died
 * at prepare time, which is why this only surfaced after the batch-2
 * unique-index fix.) The stock_movements insert in the same function has
 * the identical fallback and silently writes a NULL warehouse_id, so the
 * same missing row affects it too.
 *
 * Part 1 reproduces the exact failure on a database built the way 9d1616e
 * built it (schema + seed, no warehouse row, ensureLocalSchema NOT run).
 * Part 2 runs the real ensureLocalSchema on a fresh database and the same
 * sale must succeed, with both the movement and the level carrying the
 * default warehouse id and products.stock_qty updated.
 *
 * Run:  node --experimental-strip-types sim_sale_default_warehouse.js
 */

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
import { stockOut } from '../src/lib/stock.ts';

const SCHEMA_PARTS = [
  LOCAL_SCHEMA, LOCAL_SCHEMA_2, LOCAL_SCHEMA_3, LOCAL_SCHEMA_4,
  LOCAL_SCHEMA_5, LOCAL_SCHEMA_6, LOCAL_SCHEMA_7, LOCAL_SCHEMA_8,
  LOCAL_SCHEMA_9,
];

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    execute: async (sql) => raw.exec(sql),
    select: async (sql) => raw.prepare(sql).all(),
  };
  return { raw, db };
}
function bind(sql, params = []) {
  const ordered = [];
  const text = pgToSqlite(sql).replace(/\$(\d+)/g, (_, n) => {
    ordered.push(params[Number(n) - 1]);
    return '?';
  });
  return { sql: text, params: ordered };
}
function runOn(raw) {
  return (sql, params = []) => {
    const b = bind(sql, params);
    return raw.prepare(b.sql).all(...b.params);
  };
}
function runTxOn(raw) {
  return (statements) => {
    raw.exec('BEGIN');
    try {
      for (const s of statements) {
        const b = bind(s.sql, s.params);
        raw.prepare(b.sql).run(...b.params);
      }
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  };
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

// ── Part 1: the reported failure, reproduced ───────────────────────────────
// A database exactly as 9d1616e left it: full schema + seed, warehouses
// table present but EMPTY — ensureLocalSchema deliberately NOT run.
const { raw: rawOld } = makeDb();
const runOld = runOn(rawOld);
const runTxOld = runTxOn(rawOld);
for (const part of SCHEMA_PARTS) rawOld.exec(part);
// The real pre-fix database already had location_id: patchSyncColumns adds
// it on every launch (LOCAL_SCHEMA_5's stock_movements predates it). The
// reproduction needs it, or the sale dies on the missing column before it
// can reach the stock_levels failure being reproduced.
rawOld.exec('ALTER TABLE stock_movements ADD COLUMN location_id INTEGER');
runOld("INSERT INTO shops (id, name, currency) VALUES (1, 'My Shop', 'PKR')");
runOld("INSERT INTO products (id, shop_id, name, stock_qty) VALUES (1, 1, 'GTX 4L', 10)");

console.log('\nSale with no default warehouse (fresh local DB)');

check('reproduces the reported error: 1299 NOT NULL on stock_levels.warehouse_id', () => {
  let err = null;
  try {
    runTxOld(stockOut(1, 2, 'sale', 'uuid-sale-1', { table: 'orders', id: 201 }));
  } catch (e) {
    err = e;
  }
  assert(err, 'expected the sale to fail, but it succeeded');
  assert(
    String(err.message).includes('NOT NULL constraint failed: stock_levels.warehouse_id'),
    'expected the 1299 stock_levels.warehouse_id error, got: ' + err.message,
  );
});

// ── Part 2: the fix — a fresh install through ensureLocalSchema ────────────
// A second outlet is added before the schema runs, so the repair must cover
// every shop, not just shop 1.
const { raw, db } = makeDb();
const run = runOn(raw);
const runTx = runTxOn(raw);
for (const part of SCHEMA_PARTS) raw.exec(part);
run("INSERT INTO shops (id, name, currency) VALUES (1, 'My Shop', 'PKR')");
run("INSERT INTO shops (id, name, currency) VALUES (2, 'Outlet 2', 'PKR')");
run("INSERT INTO products (id, shop_id, name, stock_qty) VALUES (1, 1, 'GTX 4L', 10)");

await ensureLocalSchema(db);

check('every shop gains a default warehouse (uuid/name/code mirror 033)', () => {
  const rows = run('SELECT shop_id, uuid, name, code, is_default, active FROM warehouses ORDER BY shop_id');
  assert(rows.length === 2, 'expected 2 default warehouses, got ' + rows.length);
  assert(rows[0].uuid === 'wh-default-1', 'shop 1 uuid must be wh-default-1, got ' + rows[0].uuid);
  assert(rows[0].name === 'Main Store' && rows[0].code === 'MAIN', 'shop 1 name/code must be Main Store/MAIN');
  assert(rows[0].is_default === 1 && rows[0].active === 1, 'shop 1 default must be active');
  assert(rows[1].uuid === 'wh-default-2', 'shop 2 uuid must be wh-default-2, got ' + rows[1].uuid);
});

check('the same sale now succeeds', () => {
  runTx(stockOut(1, 2, 'sale', 'uuid-sale-2', { table: 'orders', id: 201 }));
});

check('stock_levels row carries the default warehouse id, qty -2', () => {
  const wh = run("SELECT id FROM warehouses WHERE shop_id = 1 AND is_default = 1")[0];
  const rows = run('SELECT warehouse_id, qty FROM stock_levels');
  assert(rows.length === 1, 'expected 1 level row, got ' + rows.length);
  assert(rows[0].warehouse_id === wh.id, 'level warehouse_id must be ' + wh.id + ', got ' + rows[0].warehouse_id);
  assert(Number(rows[0].qty) === -2, 'expected qty -2, got ' + rows[0].qty);
});

check('stock_movements row carries the default warehouse id (no silent NULL)', () => {
  const wh = run("SELECT id FROM warehouses WHERE shop_id = 1 AND is_default = 1")[0];
  const rows = run('SELECT warehouse_id, qty, qty_after FROM stock_movements');
  assert(rows.length === 1, 'expected 1 movement, got ' + rows.length);
  assert(rows[0].warehouse_id === wh.id, 'movement warehouse_id must be ' + wh.id + ', got ' + rows[0].warehouse_id);
  assert(Number(rows[0].qty) === -2, 'expected movement qty -2, got ' + rows[0].qty);
  assert(Number(rows[0].qty_after) === 8, 'expected qty_after 8, got ' + rows[0].qty_after);
});

check('products.stock_qty is updated (10 - 2 = 8)', () => {
  const rows = run('SELECT stock_qty FROM products WHERE id = 1');
  assert(Number(rows[0].stock_qty) === 8, 'expected stock_qty 8, got ' + rows[0].stock_qty);
});

check('a second repair pass is a no-op (idempotent)', () => {
  const before = run('SELECT uuid FROM warehouses ORDER BY uuid');
  raw.exec(`
    INSERT INTO warehouses (uuid, shop_id, name, code, is_default, active)
    SELECT 'wh-default-' || s.id, s.id, 'Main Store', 'MAIN', 1, 1
      FROM shops s
     WHERE NOT EXISTS (
       SELECT 1 FROM warehouses w
        WHERE w.shop_id = s.id AND w.is_default = 1 AND w.active = 1
     )
    ON CONFLICT(uuid) DO NOTHING
  `);
  const after = run('SELECT uuid FROM warehouses ORDER BY uuid');
  assert(JSON.stringify(before) === JSON.stringify(after), 'second pass changed warehouses');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
