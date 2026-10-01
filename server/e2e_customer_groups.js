/**
 * Proves grouping is the pricing priority, and carries the credit terms
 * (migration 031).
 *
 * The shopkeeper's requirement, verbatim: "the returning, wholesale or walkin,
 * pricing should follow this as priority on top of normal price."
 *
 * unit_price_lists.js proves the resolver's ladder in isolation. This proves the
 * DATA is right: that every customer is in a group, that a group's list is its
 * own tier's list, and that the credit terms are readable - because a group with
 * a NULL price_list_id silently prices by tier columns and looks perfectly
 * healthy from the outside.
 *
 * Run:  node e2e_customer_groups.js
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

console.log('\nCustomer groups as the pricing priority');

const atok = (await post('/api/auth/login', { email: 'admin@lubric.app', password: 'admin123' })).body.token;

await check('every customer is in a group', async () => {
  const rows = await q(
    `SELECT c.id, c.name, c.customer_type
       FROM customers c WHERE c.shop_id = 1 AND c.group_id IS NULL`, [], atok);
  assert(rows.length === 0,
    rows.length + ' customer(s) in no group: ' + rows.map((r) => r.name).join(', '));
});

await check('the three shop tiers exist as groups', async () => {
  const rows = await q('SELECT code, price_tier FROM customer_groups ORDER BY code', [], atok);
  const codes = rows.map((r) => r.code).sort().join(',');
  assert(codes === 'RETURNING,WALKING,WHOLESALE', 'unexpected groups: ' + codes);
});

await check('no group is left without a list (the silent-failure case)', async () => {
  // This is the check that was missing the first time round. A NULL
  // price_list_id produces no JOIN row, so a "mismatched" count reads zero and
  // looks healthy while the group quietly does nothing at all.
  const rows = await q(
    'SELECT code, name FROM customer_groups WHERE shop_id = 1 AND active = 1 AND price_list_id IS NULL',
    [], atok);
  assert(rows.length === 0,
    'group(s) with no list: ' + rows.map((r) => r.name).join(', '));
});

await check('each group points at the list for ITS OWN tier', async () => {
  const rows = await q(
    `SELECT g.code AS gcode, l.code AS lcode
       FROM customer_groups g JOIN price_lists l ON l.id = g.price_list_id
      WHERE g.shop_id = 1 AND g.active = 1`, [], atok);
  assert(rows.length > 0, 'no group has a price list - group pricing would silently do nothing');
  for (const r of rows) {
    assert(r.gcode === r.lcode,
      `group ${r.gcode} points at the ${r.lcode} list - a wholesale customer would be billed retail`);
  }
});

await check("a group's tier matches its code", async () => {
  const rows = await q('SELECT code, price_tier FROM customer_groups', [], atok);
  for (const r of rows) {
    assert(r.price_tier.toLowerCase() === r.code.toLowerCase(),
      `group ${r.code} is priced as ${r.price_tier}`);
  }
});

await check('credit terms are readable and round-trip', async () => {
  // Set, read back, restore - proving the columns are wired rather than merely
  // present in the schema.
  await exec(
    `UPDATE customer_groups SET credit_days = 30, credit_limit = 50000
      WHERE code = 'WHOLESALE'`, [], atok);
  const rows = await q(
    `SELECT credit_days, credit_limit FROM customer_groups WHERE code = 'WHOLESALE'`, [], atok);
  assert(Number(rows[0].credit_days) === 30, 'credit_days is ' + rows[0].credit_days);
  assert(Number(rows[0].credit_limit) === 50000, 'credit_limit is ' + rows[0].credit_limit);
  await exec(
    `UPDATE customer_groups SET credit_days = 0, credit_limit = 0 WHERE code = 'WHOLESALE'`,
    [], atok);
});

await check('negative credit terms are refused', async () => {
  const bad = await exec(
    `UPDATE customer_groups SET credit_days = -5 WHERE code = 'WHOLESALE'`, [], atok);
  assert(bad.status !== 200, 'a negative credit period was accepted');
  const badLimit = await exec(
    `UPDATE customer_groups SET credit_limit = -100 WHERE code = 'WHOLESALE'`, [], atok);
  assert(badLimit.status !== 200, 'a negative credit limit was accepted');
});

await check('a group tier outside the three is refused', async () => {
  const bad = await exec(
    `INSERT INTO customer_groups (uuid, shop_id, name, price_tier)
     VALUES ('cg-bogus-test', 1, 'Bogus', 'vip')`, [], atok);
  assert(bad.status !== 200, 'an unknown price tier was accepted');
  if (bad.status === 200) {
    await exec(`DELETE FROM customer_groups WHERE uuid = 'cg-bogus-test'`, [], atok);
  }
});

await check("a customer's group is one hop from the customer", async () => {
  // The query usePriceContext() actually runs, so the test fails if the hook's
  // SQL and the schema ever drift apart.
  const rows = await q(
    `SELECT c.name, g.name AS grp, g.price_tier, g.credit_days, g.credit_limit, l.code AS list
       FROM customers c
       JOIN customer_groups g ON g.id = c.group_id
       LEFT JOIN price_lists l ON l.id = g.price_list_id
      WHERE c.shop_id = 1 ORDER BY c.id`, [], atok);
  assert(rows.length > 0, 'no customers resolved through a group');
  for (const r of rows) {
    assert(r.grp, 'customer ' + r.name + ' resolved with no group name');
    assert(r.list, 'group ' + r.grp + ' reached no list');
  }
});

await check('the local SQLite replica has the group tables', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');
  assert(/CREATE TABLE IF NOT EXISTS customer_groups/.test(src),
    'localDb.ts has no customer_groups table - offline pricing would throw');
  assert(/ALTER TABLE customers ADD COLUMN group_id/.test(src),
    'localDb.ts does not add customers.group_id - the sync pull would fail on it');
  assert(/db\.execute\(LOCAL_SCHEMA_7\)/.test(src), 'LOCAL_SCHEMA_7 is never executed');
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
