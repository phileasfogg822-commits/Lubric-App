/**
 * Stock-levels uniqueness on the local (Windows) database — the sale that
 * failed 2026-11-24 with "ON CONFLICT clause does not match any PRIMARY KEY
 * or UNIQUE constraint".
 *
 * The sale's per-warehouse cache upsert (src/lib/stock.ts stockOut) conflicts
 * on (warehouse_id, product_id), but the local stock_levels table in
 * src/lib/localDb.ts had NO unique constraint on that pair — only uuid was
 * UNIQUE. The server table (migration 033) has it, so the VPS sale worked
 * and the Windows sale died at prepare time.
 *
 * This sim runs the REAL sale statements (stockOut, through pgToSqlite)
 * against the REAL local schema on a fresh database, twice, and audits
 * every other ON CONFLICT target the local path uses: the sync pull upserts
 * (src/lib/sync.ts buildPullUpsert) for every synced table, against the
 * unique indexes ensureLocalSchema creates. The pre-existing-database
 * upgrade (merge duplicates, then create the index) lives in
 * sim_stock_levels_upgrade.js — it needs its own process because
 * ensureLocalSchema runs once per module load.
 *
 * Run:  node --experimental-strip-types sim_stock_levels_unique.js
 */

import { DatabaseSync } from 'node:sqlite';
import { ensureLocalSchema, pgToSqlite } from '../src/lib/localDb.ts';
import { stockOut } from '../src/lib/stock.ts';
import { SYNC_TABLES, PULL_CONFLICT_KEYS, buildPullUpsert } from '../src/lib/sync.ts';

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
// Numbered binding, like the Tauri plugin: $2 in the text means the SECOND
// parameter, wherever it appears — and a placeholder may appear twice (the
// stock_movements INSERT uses $4 and $2 twice). A naive textual $N → ?
// rewrite binds positionally instead, so a statement whose first placeholder
// is $3 (the stock_levels upsert) silently binds the wrong values and the
// row never lands.
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

await ensureLocalSchema(db);
console.log('\nStock-levels uniqueness (fresh local DB + ON CONFLICT audit)');

// ── the sale's stock statements, on a fresh database ──────────────────────
// No warehouse row is inserted by hand any more: ensureLocalSchema now
// creates the default warehouse for shop 1 (id 1, 'Main Store'/'MAIN'),
// which is the row these checks run against — the sale below exercises the
// repair path, not a fixture.
run("INSERT INTO products (id, shop_id, name, stock_qty) VALUES (1, 1, 'GTX 4L', 10)");

check('stockOut upsert targets (warehouse_id, product_id)', () => {
  const stmts = stockOut(1, 2, 'sale', 'uuid-sale-1', { table: 'orders', id: 101 });
  assert(stmts.length === 3, 'stockOut must return 3 statements, got ' + stmts.length);
  assert(
    stmts[2].sql.includes('ON CONFLICT (warehouse_id, product_id)'),
    'stock_levels upsert lost its conflict target: ' + stmts[2].sql.slice(0, 80)
  );
});

check('fresh schema has a UNIQUE index on stock_levels(warehouse_id, product_id)', () => {
  const idxs = run('PRAGMA index_list(stock_levels)');
  const hit = idxs.some((ix) => {
    if (!ix.unique) return false;
    const cols = run(`PRAGMA index_info(${ix.name})`).map((c) => c.name);
    return cols.length === 2 && cols[0] === 'warehouse_id' && cols[1] === 'product_id';
  });
  assert(hit, 'no unique (warehouse_id, product_id) index: ' + JSON.stringify(idxs));
});

check('the sale runs twice on a fresh DB: one stock_levels row, qty summed', () => {
  runTx(stockOut(1, 2, 'sale', 'uuid-sale-1', { table: 'orders', id: 101 }));
  runTx(stockOut(1, 3, 'sale', 'uuid-sale-2', { table: 'orders', id: 102 }));
  const rows = run('SELECT warehouse_id, product_id, qty FROM stock_levels');
  assert(rows.length === 1, 'expected 1 stock_levels row, got ' + rows.length);
  assert(Number(rows[0].qty) === -5, 'expected qty -5, got ' + rows[0].qty);
  assert(Number(rows[0].warehouse_id) === 1, 'expected default warehouse 1');
  assert(run('SELECT stock_qty FROM products WHERE id = 1')[0].stock_qty === 5, 'products cache not moved');
  assert(run('SELECT COUNT(*) AS c FROM stock_movements')[0].c === 2, 'ledger must hold both movements');
});

// ── audit: every pull upsert's conflict keys have a unique index ──────────
function uniqueIndexes(table) {
  return run(`PRAGMA index_list(${table})`)
    .filter((ix) => ix.unique)
    .map((ix) => run(`PRAGMA index_info(${ix.name})`).map((c) => c.name));
}

check('every synced table has a unique index for its pull conflict keys', () => {
  const missing = [];
  for (const table of SYNC_TABLES) {
    const keys = PULL_CONFLICT_KEYS[table] ?? ['uuid'];
    const have = uniqueIndexes(table).some(
      (cols) => cols.length === keys.length && cols.every((c, i) => c === keys[i])
    );
    if (!have) missing.push(`${table} ON CONFLICT(${keys.join(', ')})`);
  }
  assert(missing.length === 0, 'missing unique indexes: ' + missing.join('; '));
});

check('order_items uuid is covered even though the column is plain TEXT', () => {
  // localDb.ts:38 declares uuid TEXT with no UNIQUE — the coverage comes
  // from idx_order_items_uuid, created in ensureLocalSchema.
  const have = uniqueIndexes('order_items').some((cols) => cols.length === 1 && cols[0] === 'uuid');
  assert(have, 'no unique uuid index on order_items');
  const upsert = buildPullUpsert('order_items', ['uuid', 'order_id', 'qty']);
  assert(upsert.sql.includes('ON CONFLICT(uuid)'), 'pull upsert does not conflict on uuid: ' + upsert.sql);
});

check('buildPullUpsert emits the audited conflict target per table', () => {
  for (const table of SYNC_TABLES) {
    const keys = PULL_CONFLICT_KEYS[table] ?? ['uuid'];
    const cols = [...keys, 'shop_id', 'updated_at'];
    const { sql } = buildPullUpsert(table, cols);
    assert(
      sql.includes(`ON CONFLICT(${keys.join(', ')})`),
      `${table}: expected ON CONFLICT(${keys.join(', ')}), got ${sql.slice(0, 120)}`
    );
  }
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
