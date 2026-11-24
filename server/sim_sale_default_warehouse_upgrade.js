/**
 * Default-warehouse repair on a PRE-EXISTING local database — the upgrade
 * half of the sale failure of 2026-11-24.
 *
 * A Windows install that updated to v3 already has a database: the full
 * schema and the seed, but an EMPTY warehouses table, because LOCAL_SEED
 * never created a warehouse row. Completing a sale on it dies with
 * "NOT NULL constraint failed: stock_levels.warehouse_id" — the sale's
 * stock statements fall back to the outlet's default warehouse and the
 * fallback is NULL. ensureLocalSchema must therefore create the default
 * warehouse on launch, or the fix only helps fresh installs.
 *
 * Own process on purpose: ensureLocalSchema runs once per module load, so
 * a second call in sim_sale_default_warehouse.js would be a no-op and this
 * database would never get repaired.
 *
 * Run:  node --experimental-strip-types sim_sale_default_warehouse_upgrade.js
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

function bind(sql, params = []) {
  const ordered = [];
  const text = pgToSqlite(sql).replace(/\$(\d+)/g, (_, n) => {
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

// ── the database as a v3 install found it ──────────────────────────────────
// Full 9d1616e schema + seed rows, warehouses table present but EMPTY —
// exactly the state that made the sale fail on the user's PC.
for (const part of [
  LOCAL_SCHEMA, LOCAL_SCHEMA_2, LOCAL_SCHEMA_3, LOCAL_SCHEMA_4,
  LOCAL_SCHEMA_5, LOCAL_SCHEMA_6, LOCAL_SCHEMA_7, LOCAL_SCHEMA_8,
  LOCAL_SCHEMA_9,
]) raw.exec(part);
run("INSERT INTO shops (id, name, currency) VALUES (1, 'My Shop', 'PKR')");
run("INSERT INTO products (id, shop_id, name, stock_qty) VALUES (1, 1, 'GTX 4L', 10)");
assert(
  run('SELECT COUNT(*) AS n FROM warehouses')[0].n === 0,
  'setup: warehouses must start empty',
);

await ensureLocalSchema(db);
console.log('\nDefault-warehouse repair (pre-existing local DB)');

check('the repair creates the default warehouse for shop 1', () => {
  const rows = run("SELECT id, uuid, name, code, is_default, active FROM warehouses WHERE shop_id = 1");
  assert(rows.length === 1, 'expected 1 warehouse, got ' + rows.length);
  assert(rows[0].uuid === 'wh-default-1', 'uuid must be wh-default-1, got ' + rows[0].uuid);
  assert(rows[0].name === 'Main Store' && rows[0].code === 'MAIN', 'name/code must be Main Store/MAIN');
  assert(rows[0].is_default === 1 && rows[0].active === 1, 'default must be active');
});

check('the sale now runs on the repaired database', () => {
  runTx(stockOut(1, 2, 'sale', 'uuid-sale-3', { table: 'orders', id: 201 }));
  const wh = run("SELECT id FROM warehouses WHERE shop_id = 1 AND is_default = 1")[0];
  const levels = run('SELECT warehouse_id, qty FROM stock_levels');
  assert(levels.length === 1, 'expected 1 level row, got ' + levels.length);
  assert(levels[0].warehouse_id === wh.id, 'level warehouse_id must be ' + wh.id);
  assert(Number(levels[0].qty) === -2, 'expected qty -2, got ' + levels[0].qty);
  const moves = run('SELECT warehouse_id FROM stock_movements');
  assert(moves.length === 1 && moves[0].warehouse_id === wh.id, 'movement must carry the default warehouse id');
  const prod = run('SELECT stock_qty FROM products WHERE id = 1');
  assert(Number(prod[0].stock_qty) === 8, 'expected stock_qty 8, got ' + prod[0].stock_qty);
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
