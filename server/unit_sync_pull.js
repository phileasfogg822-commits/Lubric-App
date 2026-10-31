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
  eq(r.sql, 'INSERT INTO customers (uuid, shop_id, name, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT(uuid) DO UPDATE SET shop_id = excluded.shop_id, name = excluded.name, updated_at = excluded.updated_at');
  eq(r.placeholders, ['$1', '$2', '$3', '$4']);
});

check('price_list_items upserts on its natural key', () => {
  const r = buildPullUpsert('price_list_items', ['price_list_id', 'product_id', 'price', 'min_qty', 'created_at', 'updated_at']);
  eq(r.sql, 'INSERT INTO price_list_items (price_list_id, product_id, price, min_qty, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(price_list_id, product_id) DO UPDATE SET price = excluded.price, min_qty = excluded.min_qty, created_at = excluded.created_at, updated_at = excluded.updated_at');
});

check('party tables upsert on their natural keys', () => {
  eq(PULL_CONFLICT_KEYS['party_price_lists'], ['party_type', 'party_id', 'price_list_id']);
  eq(PULL_CONFLICT_KEYS['party_prices'], ['party_type', 'party_id', 'product_id']);
  const r = buildPullUpsert('party_prices', ['party_type', 'party_id', 'product_id', 'price']);
  if (!r.sql.includes('ON CONFLICT(party_type, party_id, product_id) DO UPDATE SET price = excluded.price')) {
    throw new Error(`wrong upsert: ${r.sql}`);
  }
});

check('a row of only key columns degrades to DO NOTHING, not invalid SQL', () => {
  const r = buildPullUpsert('party_prices', ['party_type', 'party_id', 'product_id']);
  if (!r.sql.endsWith('ON CONFLICT(party_type, party_id, product_id) DO NOTHING')) {
    throw new Error(`wrong upsert: ${r.sql}`);
  }
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
