/**
 * Proves price lists are wired to the POS end to end (migration 028).
 *
 * unit_price_lists.js proves the resolver's rules. This proves the DATA path:
 * that the backfill preserved today's prices, that a customer's list is what
 * the POS would actually read, and that an agreed price survives the round trip.
 * Without this the tables could be correct while the app quietly kept reading
 * the old tier columns.
 *
 * Run:  node e2e_price_lists.js
 *       API_BASE=http://localhost:3001
 */

const BASE = process.env.API_BASE || 'http://localhost:3001';

let ok = 0, total = 0;
async function check(title, fn) {
  total++;
  try {
    await fn();
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}
async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function q(sql, params, token) {
  const { status, body } = await post('/api/query', { sql, params }, token);
  if (status !== 200) throw new Error('query ' + status + ' ' + JSON.stringify(body));
  return body;
}
async function exec(sql, params, token) {
  return post('/api/execute', { sql, params }, token);
}
async function auth(email, pass) {
  const { status, body } = await post('/api/auth/login', { email, password: pass });
  if (status !== 200) throw new Error('auth failed: ' + status);
  return body.token;
}

console.log('\nPrice lists wired to the POS');

const atok = await auth('admin@lubric.app', 'admin123');
const made = { customers: [], products: [], lists: [] };

// Mirrors the three queries in usePriceContext(), so this test fails if the
// hook's SQL and the schema ever drift apart.
async function readContext(customerId) {
  const [assign, items, agreed] = await Promise.all([
    q(`SELECT price_list_id FROM party_price_lists
        WHERE party_type = 'customer' AND party_id = $1`, [customerId], atok),
    q(`SELECT i.product_id, i.price, i.min_qty
         FROM price_list_items i
         JOIN party_price_lists pll ON pll.price_list_id = i.price_list_id
        WHERE pll.party_type = 'customer' AND pll.party_id = $1`, [customerId], atok),
    q(`SELECT product_id, price FROM party_prices
        WHERE party_type = 'customer' AND party_id = $1`, [customerId], atok),
  ]);
  const partyPrices = {};
  for (const r of agreed) partyPrices[Number(r.product_id)] = Number(r.price);
  return {
    priceListId: assign.length ? Number(assign[0].price_list_id) : null,
    listItems: items.map((i) => ({
      product_id: Number(i.product_id),
      price: i.price === null ? null : Number(i.price),
      min_qty: i.min_qty === null ? null : Number(i.min_qty),
    })),
    partyPrices,
  };
}

await check('every existing customer resolves to a price list', async () => {
  const rows = await q(
    `SELECT c.id, c.customer_type, pl.code
       FROM customers c
       LEFT JOIN party_price_lists pll ON pll.party_type = 'customer' AND pll.party_id = c.id
       LEFT JOIN price_lists pl ON pl.id = pll.price_list_id
      WHERE c.shop_id = 1`, [], atok);
  assert(rows.length > 0, 'no customers');
  const unmapped = rows.filter((r) => !r.code);
  assert(unmapped.length === 0,
    unmapped.length + ' customer(s) have no price list and would be charged walk-in prices');
});

await check('the backfill preserved every product price it migrated', async () => {
  // The whole safety of shipping this was that no price changes. Compare each
  // migrated list item against the column it came from.
  const ret = await q(
    `SELECT p.name, i.price, p.price_returning
       FROM price_list_items i
       JOIN price_lists l ON l.id = i.price_list_id
       JOIN products p ON p.id = i.product_id
      WHERE l.uuid = 'pl-returning' AND i.price IS DISTINCT FROM p.price_returning`, [], atok);
  assert(ret.length === 0, 'returning list drifted from the column: ' + JSON.stringify(ret));

  const walk = await q(
    `SELECT p.name, i.price, p.price_walking
       FROM price_list_items i
       JOIN price_lists l ON l.id = i.price_list_id
       JOIN products p ON p.id = i.product_id
      WHERE l.uuid = 'pl-walking' AND i.price IS DISTINCT FROM p.price_walking`, [], atok);
  assert(walk.length === 0, 'walking list drifted from the column: ' + JSON.stringify(walk));

  const whole = await q(
    `SELECT COUNT(*)::int AS bad FROM price_list_items i
       JOIN price_lists l ON l.id = i.price_list_id
       JOIN products p ON p.id = i.product_id
      WHERE l.uuid = 'pl-wholesale' AND i.min_qty IS DISTINCT FROM p.wholesale_min_qty`, [], atok);
  assert(whole[0].bad === 0, 'wholesale breaks lost their min_qty');
});

let FIX = { cid: 0, pid: 0, lid: 0 };

// /api/execute returns { rowCount, rows }; a failed statement comes back as a
// 500 with the database's own message. Asserted here rather than assumed, so a
// broken fixture reports WHY instead of dying on rows[0] of undefined.
async function insert(sql, params) {
  const r = await exec(sql, params, atok);
  assert(r.status === 200, 'fixture insert failed (' + r.status + '): ' + JSON.stringify(r.body));
  assert(r.body.rows && r.body.rows.length, 'fixture insert returned no rows: ' + JSON.stringify(r.body));
  return Number(r.body.rows[0].id);
}

await check("a customer's own list price is what the hook would read", async () => {
  FIX.pid = await insert(
    `INSERT INTO products (shop_id, name, price_returning, price_walking, price_wholesale,
                           wholesale_min_qty, active)
     VALUES (1, $1, 4800, 5000, 4500, 10, 1) RETURNING id`,
    ['e2e plist product ' + Date.now()]);
  FIX.cid = await insert(
    // No `active` column: customers are removed with a soft-delete flag that is
    // not called active, and guessing the schema is how a fixture ends up
    // testing nothing.
    `INSERT INTO customers (shop_id, name, phone, customer_type)
     VALUES (1, $1, $2, 'wholesale') RETURNING id`,
    ['e2e plist customer ' + Date.now(), '0300' + Date.now()]);
  FIX.lid = await insert(
    `INSERT INTO price_lists (uuid, shop_id, name, code, active)
     VALUES ($1, 1, 'e2e contract', 'E2ECONTRACT', 1) RETURNING id`,
    ['pl-e2e-' + Date.now()]);

  made.products.push(FIX.pid);
  made.customers.push(FIX.cid);
  made.lists.push(FIX.lid);

  // A price deliberately different from the product's tiers, so the test can
  // tell which source the read came from.
  await exec(
    `INSERT INTO price_list_items (price_list_id, product_id, price, min_qty)
     VALUES ($1, $2, 4200, NULL)`, [FIX.lid, FIX.pid], atok);
  await exec(
    `INSERT INTO party_price_lists (shop_id, party_type, party_id, price_list_id)
     VALUES (1, 'customer', $1, $2)`, [FIX.cid, FIX.lid], atok);

  const ctx = await readContext(FIX.cid);
  assert(ctx.priceListId === FIX.lid, 'hook read list ' + ctx.priceListId + ', expected ' + FIX.lid);
  const mine = ctx.listItems.find((i) => i.product_id === FIX.pid);
  assert(mine && mine.price === 4200, 'list price not readable: ' + JSON.stringify(mine));
});

await check('an individually agreed price round-trips through party_prices', async () => {
  await exec(
    `INSERT INTO party_prices (shop_id, party_type, party_id, product_id, price, note)
     VALUES (1, 'customer', $1, $2, 3800, 'agreed over the phone')`, [FIX.cid, FIX.pid], atok);
  const ctx = await readContext(FIX.cid);
  assert(ctx.partyPrices[FIX.pid] === 3800,
    'agreed price not readable, got ' + JSON.stringify(ctx.partyPrices));
});

await check('one agreed price per customer per product is enforced', async () => {
  const again = await exec(
    `INSERT INTO party_prices (shop_id, party_type, party_id, product_id, price)
     VALUES (1, 'customer', $1, $2, 3700)`, [FIX.cid, FIX.pid], atok);
  assert(again.status !== 200, 'a second agreed price for the same product was accepted');
});

await check('a list cannot hold two "any quantity" rows for one product', async () => {
  // The NULLS NOT DISTINCT index is what stops resolution depending on row order.
  const dup = await exec(
    `INSERT INTO price_list_items (price_list_id, product_id, price, min_qty)
     VALUES ($1, $2, 1111, NULL)`, [FIX.lid, FIX.pid], atok);
  assert(dup.status !== 200, 'a duplicate "any quantity" row was accepted');
});

await check('the local SQLite replica has all four tables', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');
  for (const t of ['price_lists', 'price_list_items', 'party_price_lists', 'party_prices']) {
    assert(new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '\\b').test(src),
      'localDb.ts is missing ' + t + ' - the POS would throw "no such table" offline');
  }
  assert(/db\.execute\(LOCAL_SCHEMA_6\)/.test(src), 'LOCAL_SCHEMA_6 is never executed');
});

await check('cleanup', async () => {
  // Deletes are NOT swallowed here. A cleanup that fails quietly is how a test
  // leaves rows behind, and how the next run then fails for a reason that has
  // nothing to do with what it is testing.
  const failed = [];
  const del = async (sql, params, what) => {
    const r = await exec(sql, params, atok);
    if (r.status !== 200) failed.push(what + ': ' + JSON.stringify(r.body));
  };
  for (const id of made.lists) {
    await del('DELETE FROM price_list_items WHERE price_list_id = $1', [id], 'list items ' + id);
    await del('DELETE FROM price_lists WHERE id = $1', [id], 'list ' + id);
  }
  for (const id of made.customers) {
    await del(`DELETE FROM party_price_lists WHERE party_type = 'customer' AND party_id = $1`, [id], 'ppl ' + id);
    await del(`DELETE FROM party_prices WHERE party_type = 'customer' AND party_id = $1`, [id], 'party price ' + id);
    await del('DELETE FROM customers WHERE id = $1', [id], 'customer ' + id);
  }
  for (const id of made.products) {
    await del('DELETE FROM price_list_items WHERE product_id = $1', [id], 'product item ' + id);
    await del('DELETE FROM products WHERE id = $1', [id], 'product ' + id);
  }
  assert(failed.length === 0, 'cleanup errors: ' + failed.join(' | '));

  const left = await q(`SELECT id, name FROM products WHERE name LIKE 'e2e plist product%'`, [], atok);
  assert(left.length === 0,
    left.length + ' test products left behind: ' + JSON.stringify(left) +
    ' (tried deleting product ids: ' + JSON.stringify(made.products) + ')');
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
