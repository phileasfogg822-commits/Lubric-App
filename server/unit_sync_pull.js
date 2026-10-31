/**
 * Unit tests for the pull upsert builder (src/lib/sync.ts).
 *
 * Run:  node --experimental-strip-types server/unit_sync_pull.js
 */

import { buildPullUpsert, PULL_CONFLICT_KEYS } from '../src/lib/sync.ts';

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { console.log(`FAIL - ${title}: ${e.message}`); }
}
function eq(a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`expected ${sb}, got ${sa}`);
}

check('uuid tables upsert on uuid, excluding it from SET', () => {
  const r = buildPullUpsert('customers', ['uuid', 'shop_id', 'name', 'updated_at']);
  eq(r.sql, 'INSERT INTO customers (uuid, shop_id, name, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT(uuid) DO UPDATE SET shop_id = excluded.shop_id, name = excluded.name, updated_at = excluded.updated_at WHERE (1)');
  eq(r.placeholders, ['$1', '$2', '$3', '$4']);
});

check('price_list_items upserts on its natural key', () => {
  const r = buildPullUpsert('price_list_items', ['price_list_id', 'product_id', 'price', 'min_qty', 'created_at', 'updated_at']);
  eq(r.sql, 'INSERT INTO price_list_items (price_list_id, product_id, price, min_qty, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(price_list_id, product_id) DO UPDATE SET price = excluded.price, min_qty = excluded.min_qty, created_at = excluded.created_at, updated_at = excluded.updated_at WHERE (1)');
});

check('party tables upsert on their natural keys', () => {
  eq(PULL_CONFLICT_KEYS['party_price_lists'], ['party_type', 'party_id', 'price_list_id']);
  eq(PULL_CONFLICT_KEYS['party_prices'], ['party_type', 'party_id', 'product_id']);
  const r = buildPullUpsert('party_prices', ['party_type', 'party_id', 'product_id', 'price']);
  if (!r.sql.includes('ON CONFLICT(party_type, party_id, product_id) DO UPDATE SET price = excluded.price WHERE (1)')) {
    throw new Error(`wrong upsert: ${r.sql}`);
  }
});

check('a row of only key columns degrades to DO NOTHING, not invalid SQL', () => {
  const r = buildPullUpsert('party_prices', ['party_type', 'party_id', 'product_id']);
  if (!r.sql.endsWith('ON CONFLICT(party_type, party_id, product_id) DO NOTHING')) {
    throw new Error(`wrong upsert: ${r.sql}`);
  }
});

// Faithful port of the Android plugin's RETURNING detection
// (Database.java isReturning, INSERT case): scan backwards for the last ')',
// truncate there, and flag the statement if the tail contains "returning".
// The plugin then compiles the TRUNCATED statement, so a flagged upsert
// dies with "near ';': syntax error" on the phone.
function pluginFlagsAsReturning(sql) {
  const stmt = sql.trim();
  const valuesIndex = stmt.toUpperCase().indexOf('VALUES');
  if (valuesIndex === -1) return { flagged: false, truncated: stmt };
  let closeIdx = -1;
  for (let i = stmt.length - 1; i >= valuesIndex; i--) {
    if (stmt[i] === ')') { closeIdx = i; break; }
  }
  if (closeIdx === -1) return { flagged: false, truncated: stmt };
  const tail = stmt.substring(closeIdx + 1).trim();
  if (tail.toLowerCase().includes('returning')) {
    return { flagged: true, truncated: stmt.substring(0, closeIdx + 1).trim() + ';' };
  }
  return { flagged: false, truncated: stmt };
}

check('the products upsert does NOT trip the plugin RETURNING detection', () => {
  const cols = ['shop_id', 'sku', 'barcode', 'name', 'brand_id', 'category_id', 'packing', 'unit', 'variant', 'mfd_date', 'exp_date', 'offer', 'cost_price', 'stock_qty', 'low_stock_threshold', 'price_returning', 'price_walking', 'price_wholesale', 'wholesale_min_qty', 'active', 'created_at', 'vendor_id', 'received_date', 'uuid', 'updated_at', 'deleted_at', 'unit_id'];
  const r = buildPullUpsert('products', cols);
  const d = pluginFlagsAsReturning(r.sql);
  if (d.flagged) throw new Error(`plugin would truncate to: ${d.truncated}`);
});

check('the detection simulation really captures the bug (old shape flags)', () => {
  const oldSql = 'INSERT INTO products (shop_id, price_returning, uuid) VALUES ($1, $2, $3) ON CONFLICT(uuid) DO UPDATE SET shop_id = excluded.shop_id, price_returning = excluded.price_returning';
  const d = pluginFlagsAsReturning(oldSql);
  if (!d.flagged) throw new Error('simulation missed the old shape');
  eq(d.truncated, 'INSERT INTO products (shop_id, price_returning, uuid) VALUES ($1, $2, $3) ON CONFLICT(uuid);');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
