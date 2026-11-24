/**
 * Stock-levels upgrade on a PRE-EXISTING local database — the other half of
 * the sale failure of 2026-11-24.
 *
 * A database created before the fix has a stock_levels table with NO unique
 * constraint (CREATE TABLE IF NOT EXISTS never alters it), so the sale's
 * upsert on (warehouse_id, product_id) dies at prepare time. ensureLocalSchema
 * must therefore merge any duplicate (warehouse_id, product_id) rows first
 * (qty summed into the lowest-id row, the rest deleted) and then create the
 * unique index — otherwise the index creation itself fails on the duplicates.
 *
 * Own process on purpose: ensureLocalSchema runs once per module load, so a
 * second call in sim_stock_levels_unique.js would be a no-op and this
 * database would never get upgraded.
 *
 * Run:  node --experimental-strip-types sim_stock_levels_upgrade.js
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

const raw = new DatabaseSync(':memory:');

const db = {
  execute: async (sql) => raw.exec(sql),
  select: async (sql) => raw.prepare(sql).all(),
};

function toSqlite(sql) {
  return pgToSqlite(sql);
}
// Numbered binding, like the Tauri plugin — see sim_stock_levels_unique.js.
function bind(sql, params = []) {
  const ordered = [];
  const text = toSqlite(sql).replace(/\$(\d+)/g, (_, n) => {
    ordered.push(params[Number(n) - 1]);
    return '?';
  });
  return { sql: text, params: ordered };
}
function run(sql, params = []) {
  const b = bind(sql, params);
  return raw.prepare(b.sql).all(...b.params);
}
function runTx(statements) {
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

// ── the database as it existed before the fix ─────────────────────────────
// The old stock_levels DDL, verbatim except for the missing UNIQUE pair,
// created FIRST: the real schema below uses CREATE TABLE IF NOT EXISTS, so
// it leaves this table alone and creates everything else with real columns
// (the hand-made minimal tables in the first draft broke on
// idx_products_category, which needs products.category_id).
raw.exec(`
CREATE TABLE IF NOT EXISTS stock_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE, shop_id INTEGER DEFAULT 1,
  warehouse_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
  qty REAL DEFAULT 0, updated_at TEXT
);
`);
for (const part of [
  LOCAL_SCHEMA, LOCAL_SCHEMA_2, LOCAL_SCHEMA_3, LOCAL_SCHEMA_4, LOCAL_SCHEMA_5,
  LOCAL_SCHEMA_6, LOCAL_SCHEMA_7, LOCAL_SCHEMA_8, LOCAL_SCHEMA_9,
]) raw.exec(part);
run("INSERT INTO warehouses (id, shop_id, name, is_default, active) VALUES (1, 1, 'Main', 1, 1)");
run("INSERT INTO products (id, shop_id, name, stock_qty) VALUES (1, 1, 'GTX 4L', 10)");
// Duplicates the old code could leave behind: two rows, same pair, qty split.
run("INSERT INTO stock_levels (id, warehouse_id, product_id, qty) VALUES (1, 1, 1, 5)");
run("INSERT INTO stock_levels (id, warehouse_id, product_id, qty) VALUES (2, 1, 1, 3)");
run("INSERT INTO stock_levels (id, warehouse_id, product_id, qty) VALUES (3, 1, 1, -2)");

await ensureLocalSchema(db);
console.log('\nStock-levels upgrade (pre-existing local DB)');

check('duplicate rows merge: qty summed into the lowest-id row, rest deleted', () => {
  const rows = run('SELECT id, qty FROM stock_levels ORDER BY id');
  assert(rows.length === 1, 'expected 1 row after merge, got ' + rows.length);
  assert(rows[0].id === 1, 'keeper must be the lowest id, got ' + rows[0].id);
  assert(Number(rows[0].qty) === 6, 'expected qty 5 + 3 - 2 = 6, got ' + rows[0].qty);
});

check('the unique index exists after the upgrade', () => {
  const idxs = run('PRAGMA index_list(stock_levels)');
  const hit = idxs.some((ix) => {
    if (!ix.unique) return false;
    const cols = run(`PRAGMA index_info(${ix.name})`).map((c) => c.name);
    return cols.length === 2 && cols[0] === 'warehouse_id' && cols[1] === 'product_id';
  });
  assert(hit, 'no unique (warehouse_id, product_id) index: ' + JSON.stringify(idxs));
});

check('the sale now runs on the upgraded database', () => {
  runTx(stockOut(1, 2, 'sale', 'uuid-sale-9', { table: 'orders', id: 201 }));
  const rows = run('SELECT qty FROM stock_levels');
  assert(rows.length === 1, 'expected 1 row, got ' + rows.length);
  assert(Number(rows[0].qty) === 4, 'expected qty 6 - 2 = 4, got ' + rows[0].qty);
});

check('a second upgrade pass is a no-op (idempotent)', () => {
  // ensureLocalSchema runs once per module load, so re-run the upgrade step
  // the way a second app launch would: the statements themselves must not
  // change anything when there is nothing left to merge.
  const before = run('SELECT id, qty FROM stock_levels');
  raw.exec(`
    UPDATE stock_levels SET qty = (
      SELECT COALESCE(SUM(s2.qty), 0) FROM stock_levels s2
       WHERE s2.product_id = stock_levels.product_id
         AND s2.warehouse_id IS stock_levels.warehouse_id
    ) WHERE id IN (
      SELECT MIN(id) FROM stock_levels GROUP BY warehouse_id, product_id
    );
    DELETE FROM stock_levels WHERE id NOT IN (
      SELECT MIN(id) FROM stock_levels GROUP BY warehouse_id, product_id
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_levels_wh_prod ON stock_levels(warehouse_id, product_id);
  `);
  const after = run('SELECT id, qty FROM stock_levels');
  assert(JSON.stringify(before) === JSON.stringify(after), 'second pass changed rows');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
