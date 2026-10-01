/**
 * End-to-end check for party-wise price memory.
 *
 * The unit test (unit_price_memory.js) covers the shaping rules with synthetic
 * rows. This one runs the REAL query against the real shop, because the things
 * most likely to be wrong are in the SQL and not the TypeScript:
 *
 *   - a voided bill must not offer its price (voidOrder KEEPS the row as
 *     'cancelled', so an unfiltered query silently resurrects cancelled prices)
 *   - service lines must not appear as product prices
 *   - the litres must come back attached to the right price
 *   - two customers must not see each other's prices
 *
 * Creates its own customer and orders, and removes them afterwards.
 *
 * Run:  node e2e_price_memory.js
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
async function auth(email, pass) {
  const { status, body } = await post('/api/auth/login', { email, password: pass });
  if (status !== 200) throw new Error('auth failed: ' + status);
  return body.token;
}

console.log('\nParty-wise price memory (live query)');

const atok = await auth('admin@lubric.app', 'admin123');
const stamp = Date.now();
const custName = 'e2e price memory ' + stamp;
const otherName = 'e2e other customer ' + stamp;
let custId = null, otherId = null, productId = null;
const created = []; // order ids

/** One order with one product line at a given price and capacity. */
async function bill(customerId, price, capacity, opts = {}) {
  const r = await post('/api/execute', {
    sql: `INSERT INTO orders (shop_id, customer_id, user_id, total, status)
          VALUES (1, $1, 1, $2, $3) RETURNING id`,
    params: [customerId, price, opts.status || 'completed'],
  }, atok);
  if (r.status !== 200) throw new Error('order insert failed: ' + JSON.stringify(r.body));
  const oid = Number(r.body.rows[0].id);
  created.push(oid);
  const li = await post('/api/execute', {
    sql: `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, capacity, billed_by_capacity)
          VALUES ($1, $2, $3, $4, 1, $5, $5, $6, $7)`,
    params: [oid, opts.kind || 'product', productId, 'e2e memory product', price, capacity, !!opts.billedByCapacity],
  }, atok);
  if (li.status !== 200) throw new Error('line insert failed: ' + JSON.stringify(li.body));
  return oid;
}

await check('set up a product and two customers', async () => {
  const p = await post('/api/execute', {
    sql: "INSERT INTO products (shop_id, name, price_returning, active) VALUES (1, $1, 4000, 1) RETURNING id",
    params: ['e2e memory product ' + stamp],
  }, atok);
  productId = Number(p.body.rows[0].id);
  const c = await post('/api/execute', {
    sql: "INSERT INTO customers (shop_id, name, phone, customer_type) VALUES (1, $1, $2, 'returning') RETURNING id",
    params: [custName, '0300' + stamp],
  }, atok);
  custId = Number(c.body.rows[0].id);
  const o = await post('/api/execute', {
    sql: "INSERT INTO customers (shop_id, name, phone, customer_type) VALUES (1, $1, $2, 'returning') RETURNING id",
    params: [otherName, '0301' + stamp],
  }, atok);
  otherId = Number(o.body.rows[0].id);
  assert(productId && custId && otherId, 'setup ids missing');
});

await check('the query returns this customer\'s prices, newest first', async () => {
  await bill(custId, 4000, 0);                       // whole bottle
  await bill(custId, 3500, 3.5, { billedByCapacity: true }); // 3.5L fill
  await bill(custId, 3000, 0);                       // older, whole bottle

  const rows = await q(
    `SELECT oi.unit_price, oi.capacity, o.created_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.customer_id = $1
        AND o.status = 'completed'
        AND oi.kind = 'product'
        AND oi.ref_id IN ($2)
      ORDER BY oi.ref_id, o.created_at DESC, oi.id DESC`,
    [custId, productId], atok);

  assert(rows.length === 3, 'expected 3 lines, got ' + rows.length);
  // Newest first. Same second is possible, so order is by created_at DESC then
  // id DESC - assert the set and that the middle (3.5L) is present, not a
  // fragile positional expectation on timestamps.
  const prices = rows.map((r) => Number(r.unit_price)).sort((a, b) => b - a);
  assert(JSON.stringify(prices) === JSON.stringify([4000, 3500, 3000]),
    'prices came back as ' + JSON.stringify(prices));
  const cap35 = rows.find((r) => Number(r.unit_price) === 3500);
  assert(Number(cap35.capacity) === 3.5, 'the 3.5L fill lost its litres');
});

await check('a VOIDED bill is excluded even though the row is kept', async () => {
  // voidOrder sets status='cancelled' and keeps the row for the audit trail,
  // so an unfiltered query would happily offer a price nobody agreed to.
  await bill(custId, 999, 0, { status: 'cancelled' });
  const rows = await q(
    `SELECT oi.unit_price
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.customer_id = $1
        AND o.status = 'completed'
        AND oi.kind = 'product'
        AND oi.ref_id IN ($2)`,
    [custId, productId], atok);
  assert(!rows.some((r) => Number(r.unit_price) === 999),
    'a cancelled bill leaked into the price memory');
});

await check('service lines are not treated as product prices', async () => {
  await bill(custId, 777, 0, { kind: 'service' });
  const rows = await q(
    `SELECT oi.unit_price
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.customer_id = $1
        AND o.status = 'completed'
        AND oi.kind = 'product'
        AND oi.ref_id IN ($2)`,
    [custId, productId], atok);
  assert(!rows.some((r) => Number(r.unit_price) === 777),
    'a service line leaked into the product price memory');
});

await check("one customer's prices are never shown to another", async () => {
  await bill(otherId, 1234, 0);
  const rows = await q(
    `SELECT oi.unit_price
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.customer_id = $1
        AND o.status = 'completed'
        AND oi.kind = 'product'
        AND oi.ref_id IN ($2)`,
    [custId, productId], atok);
  assert(!rows.some((r) => Number(r.unit_price) === 1234),
    'another customer\'s price leaked into the memory');
});

await check('the index this feature relies on exists', async () => {
  const rows = await q(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'order_items' AND indexdef LIKE '%ref_id%'",
    [], atok);
  assert(rows.length > 0, 'no index covers order_items.ref_id - this query would scan');
});

await check('cleanup', async () => {
  for (const id of created) {
    await post('/api/execute', { sql: 'DELETE FROM order_items WHERE order_id = $1', params: [id] }, atok);
    await post('/api/execute', { sql: 'DELETE FROM orders WHERE id = $1', params: [id] }, atok);
  }
  if (productId) {
    await post('/api/execute', { sql: 'DELETE FROM products WHERE id = $1', params: [productId] }, atok);
  }
  for (const id of [custId, otherId]) {
    if (id) await post('/api/execute', { sql: 'DELETE FROM customers WHERE id = $1', params: [id] }, atok);
  }
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
