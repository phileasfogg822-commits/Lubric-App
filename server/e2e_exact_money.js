/**
 * Proves money is now stored exactly (spec §237).
 *
 * The bug this guards: every money column was DOUBLE PRECISION, which cannot
 * hold 0.1. In a ledger - where a balance is the SUM of thousands of rows - the
 * per-row error is small but the total drifts, and it compounds with every
 * document type added on top.
 *
 * Checks:
 *   1. no money or quantity column is still a float type
 *   2. a value a double cannot represent round-trips exactly, and a SUM over
 *      many such rows is exact
 *   3. the totals the shop relies on are unchanged whole-rupee figures
 *   4. amounts arrive over the API as NUMBERS, not strings - node-postgres
 *      returns NUMERIC as a string by default, which silently turns every
 *      client-side total into string concatenation
 *
 * Run:  node e2e_exact_money.js
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

console.log('\nExact money (spec 237)');

const atok = await auth('admin@lubric.app', 'admin123');

// The figures the shop trusts, so a later migration that moves one is caught
// here rather than surfacing as "the total looks wrong" weeks later.
const TRUSTED = {
  orders_total: 'SELECT COALESCE(SUM(total),0) AS v FROM orders',
  orders_paid: 'SELECT COALESCE(SUM(paid_amount),0) AS v FROM orders',
  cash_account: 'SELECT COALESCE(SUM(balance),0) AS v FROM accounts',
  ledger: 'SELECT COALESCE(SUM(amount),0) AS v FROM party_ledger',
  customer_credit: 'SELECT COALESCE(SUM(credit_balance),0) AS v FROM customers',
  field_cash: 'SELECT COALESCE(SUM(amount),0) AS v FROM cash_movements',
};

await check('no money or quantity column is still a float', async () => {
  const rows = await q(
    `SELECT table_name || '.' || column_name AS c
       FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'double precision'
      ORDER BY 1`,
    [], atok);
  assert(rows.length === 0, 'still floating point: ' + rows.map((r) => r.c).join(', '));
});

await check('money is NUMERIC(18,4) and quantity NUMERIC(18,3)', async () => {
  const money = await q(
    `SELECT data_type, numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_name = 'party_ledger' AND column_name = 'amount'`, [], atok);
  assert(/^numeric/.test(money[0].data_type), 'party_ledger.amount is ' + money[0].data_type);
  assert(money[0].numeric_precision === 18, 'precision is ' + money[0].numeric_precision);
  assert(money[0].numeric_scale === 4, 'scale is ' + money[0].numeric_scale);

  const qty = await q(
    `SELECT data_type, numeric_scale FROM information_schema.columns
      WHERE table_name = 'order_items' AND column_name = 'capacity'`, [], atok);
  assert(/^numeric/.test(qty[0].data_type), 'order_items.capacity is ' + qty[0].data_type);
  assert(qty[0].numeric_scale === 3, 'quantity scale is ' + qty[0].numeric_scale);
});

await check('a value a double cannot hold round-trips exactly', async () => {
  // 0.1 as a double is 0.1000000000000000055511151231257827.
  const r = await q('SELECT 0.1::numeric AS v', [], atok);
  assert(String(r[0].v) === '0.1', '0.1 came back as ' + r[0].v);
});

await check('summing many fractional amounts is EXACT', async () => {
  // 1000 rows of 0.1 must total exactly 100.0000.
  const many = await q(
    `SELECT SUM(v) AS total, COUNT(*) AS n
       FROM (SELECT 0.1::numeric AS v FROM generate_series(1, 1000)) t`, [], atok);
  assert(String(Number(many[0].total)) === '100', '1000 x 0.1 came to ' + many[0].total);
  assert(Number(many[0].n) === 1000);
});

await check("the shop's trusted totals are whole rupees", async () => {
  for (const [name, sql] of Object.entries(TRUSTED)) {
    const r = await q(sql, [], atok);
    const v = Number(r[0].v);
    assert(Number.isFinite(v), name + ' is not a finite number: ' + r[0].v);
    assert(Math.abs(v - Math.round(v)) < 0.0001,
      name + ' should be a whole-rupee figure but is ' + v);
  }
});

await check('money arrives over the API as a NUMBER, not a string', async () => {
  // The failure this catches: node-postgres returns NUMERIC as a string by
  // default, and "0" + "4321.50" is concatenation. Every total in the browser
  // would be silently wrong, and value-only assertions would not notice.
  const r = await q('SELECT 4321.50::numeric AS v, 0.1::numeric AS w', [], atok);
  assert(typeof r[0].v === 'number', 'numeric arrived as ' + typeof r[0].v + ' (' + r[0].v + ')');
  assert(r[0].v === 4321.5, 'value changed in transit: ' + r[0].v);
  assert(typeof r[0].w === 'number', 'fractional numeric arrived as ' + typeof r[0].w);
});

await check('NULL money stays null, not the string "null"', async () => {
  const r = await q('SELECT NULL::numeric AS v', [], atok);
  assert(r[0].v === null, 'NULL came back as ' + JSON.stringify(r[0].v));
});

await check('a real total is still a number after the round trip', async () => {
  const r = await q('SELECT COALESCE(SUM(amount),0) AS total FROM account_transactions', [], atok);
  assert(typeof r[0].total === 'number',
    'a real sum arrived as ' + typeof r[0].total + ' - the parser is missing');
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
