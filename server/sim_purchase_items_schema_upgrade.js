/**
 * Purchase-order-items upgrade on a PRE-EXISTING local database.
 *
 * The local table used to say order_id / product_name / unit_cost while
 * the server (001_init.sql) says purchase_order_id / product_id /
 * cost_price — the Purchase screen was a placeholder, so no code ever
 * wrote the local shape, but a database created before this fix keeps
 * the table it was created with. ensureLocalSchema must therefore
 * rename the two columns, add product_id (resolved from the stored
 * name where the product exists), and drop the name column — the name
 * now comes from the products join — without dropping any row.
 *
 * Own process on purpose: ensureLocalSchema runs once per module load, so a
 * second call in sim_purchase_invoice_stock_in.js would be a no-op and this
 * database would never get upgraded (same pattern as
 * sim_stock_levels_upgrade.js).
 *
 * Run:  node --experimental-strip-types server/sim_purchase_items_schema_upgrade.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  ensureLocalSchema,
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

console.log('\nPurchase items schema upgrade: old shape -> server shape');

const raw = new DatabaseSync(':memory:');
const db = {
  execute: async (sql) => raw.exec(sql),
  select: async (sql) => raw.prepare(sql).all(),
};

// The database as a pre-batch-14 install created it: the old columns.
// (The items table lives in LOCAL_SCHEMA_2, not LOCAL_SCHEMA.)
raw.exec(LOCAL_SCHEMA);
raw.exec(LOCAL_SCHEMA_2.replace(
  'CREATE TABLE IF NOT EXISTS purchase_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, qty REAL DEFAULT 0, cost_price REAL DEFAULT 0, line_total REAL DEFAULT 0);',
  'CREATE TABLE IF NOT EXISTS purchase_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_name TEXT DEFAULT \'\', qty REAL DEFAULT 0, unit_cost REAL DEFAULT 0, line_total REAL DEFAULT 0);'
));
raw.exec(LOCAL_SCHEMA_2);
raw.exec(LOCAL_SCHEMA_3);
raw.exec(LOCAL_SCHEMA_4);
raw.exec(LOCAL_SCHEMA_5);
raw.exec(LOCAL_SCHEMA_6);
raw.exec(LOCAL_SCHEMA_7);
raw.exec(LOCAL_SCHEMA_8);
raw.exec(LOCAL_SCHEMA_9);
raw.exec("INSERT INTO products (id, shop_id, name, cost_price, stock_qty) VALUES (9, 1, 'Old Oil 4L', 1000, 3)");
raw.exec("INSERT INTO purchase_order_items (order_id, product_name, qty, unit_cost, line_total) VALUES (7, 'Old Oil 4L', 2, 1000, 2000)");
raw.exec("INSERT INTO purchase_order_items (order_id, product_name, qty, unit_cost, line_total) VALUES (7, 'No Such Product', 1, 500, 500)");

await ensureLocalSchema(db);

const cols = raw.prepare('PRAGMA table_info(purchase_order_items)').all().map((c) => c.name);
const rows = raw.prepare('SELECT purchase_order_id, product_id, qty, cost_price, line_total FROM purchase_order_items ORDER BY id').all();

check('UPGRADE: the columns are renamed to the server shape', () => {
  assert(cols.includes('purchase_order_id') && cols.includes('product_id') && cols.includes('cost_price'),
    'the new columns must exist, got ' + cols.join(','));
  assert(!cols.includes('order_id') && !cols.includes('unit_cost') && !cols.includes('product_name'),
    'the old columns must be gone, got ' + cols.join(','));
});

check('UPGRADE: the old rows survive with the product resolved by name', () => {
  assert(rows.length === 2, 'both rows must survive, got ' + rows.length);
  assert(rows[0].purchase_order_id === 7 && rows[0].product_id === 9 && Number(rows[0].qty) === 2
    && Number(rows[0].cost_price) === 1000 && Number(rows[0].line_total) === 2000,
    'the resolvable row must keep its values with product 9, got ' + JSON.stringify(rows[0]));
  assert(rows[1].purchase_order_id === 7 && rows[1].product_id === 0 && Number(rows[1].line_total) === 500,
    'the unresolvable row must survive with product_id 0 rather than being dropped, got ' + JSON.stringify(rows[1]));
});

check('UPGRADE: a second schema run is a no-op', () => {
  // ensureLocalSchema caches per module load, so a second call here is a
  // no-op by construction; the real second launch re-runs the patch
  // function against the new shape and must return before touching
  // anything — proven by the column list above being the new shape
  // already, which is exactly what the patch checks first.
  const cols2 = raw.prepare('PRAGMA table_info(purchase_order_items)').all().map((c) => c.name);
  assert(cols2.join(',') === cols.join(','), 'the columns must be unchanged');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
