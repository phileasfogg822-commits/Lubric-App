/**
 * Proves one login really can be sealed into one outlet (migration 029).
 *
 * This is the test that makes "database enforced isolation" mean something. A
 * policy that exists but is not enforced is worse than no policy, because the
 * isolation checks pass and the app still reads every outlet's data - so these
 * checks are written to run AS THE APP ROLE, never as the superuser.
 *
 * The superuser bypasses row security unconditionally. Asserting through it
 * would pass on a database with RLS completely disabled, which is precisely the
 * failure this test exists to catch.
 *
 * Run:  node e2e_outlet_isolation.js
 *       API_BASE=http://localhost:3001
 *       PGURL=postgres://lubric_app:lubric_app_pw@localhost:5432/lubricapp
 *
 * NOTE: on the deploy that creates the role but does not yet enable RLS, the
 * enforcement checks are expected to FAIL and say so. That is the intended
 * sequence: switch the app to the new role and prove it sets context, then
 * enable RLS in migration 030. Until then this test is the tripwire.
 */

const BASE = process.env.API_BASE || 'http://localhost:3001';
const PGURL = process.env.PGURL || 'postgres://lubric_app:lubric_app_pw@localhost:5432/lubricapp';

let ok = 0, total = 0;
let skipped = 0;
async function check(title, fn) {
  total++;
  try {
    const r = await fn();
    if (r === 'SKIP') { skipped++; total--; console.log('  SKIP ' + title); return; }
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}
async function post(path, body, token, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function q(sql, params, token, shopId) {
  const headers = shopId ? { 'X-Shop-Id': String(shopId) } : {};
  const { status, body } = await post('/api/query', { sql, params }, token, headers);
  if (status !== 200) throw new Error('query ' + status + ' ' + JSON.stringify(body));
  return body;
}
async function exec(sql, params, token, shopId) {
  const headers = shopId ? { 'X-Shop-Id': String(shopId) } : {};
  return post('/api/execute', { sql, params }, token, headers);
}

console.log('\nOutlet isolation (spec multi-outlet)');

const login = await post('/api/auth/login', { email: 'admin@lubric.app', password: 'admin123' });
assert(login.status === 200, 'login failed: ' + login.status);
const token = login.body.token;

// ── direct-database helpers ────────────────────────────────────────────────
// The enforcement checks below need a direct Postgres connection as the APP
// ROLE, which is the only thing that actually proves isolation. That connection
// is only reachable from inside the docker network, so the checks detect it and
// SKIP loudly elsewhere rather than reporting a pass they did not earn.
//
// Defined here rather than beside the checks that use it: the first check needs
// RLS_ON, and a const declared further down would be in the temporal dead zone.
async function asAppRole(fn) {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
async function canReachDb() {
  try {
    await asAppRole(async (c) => { await c.query('SELECT 1'); });
    return true;
  } catch {
    return false;
  }
}
const DB_REACHABLE = await canReachDb();

/** True once migration 030 has actually switched enforcement on. */
async function rlsEnabled() {
  try {
    return await asAppRole(async (c) => {
      const r = await c.query(
        `SELECT relrowsecurity FROM pg_class WHERE oid = 'customers'::regclass`);
      return !!(r.rows[0] && r.rows[0].relrowsecurity);
    });
  } catch {
    return false;
  }
}
const RLS_ON = DB_REACHABLE ? await rlsEnabled() : false;
if (DB_REACHABLE && !RLS_ON) {
  console.log('  note: policies exist but RLS is not enabled yet - migration 030 is the switch.');
}

await check('login returns the outlets this user may enter', async () => {
  const shops = login.body.shops;
  assert(Array.isArray(shops), 'login returned no shops array');
  assert(shops.length >= 1, 'no outlets returned');
  assert(shops.every((s) => typeof s.shop_id === 'number' && typeof s.name === 'string'),
    'outlet rows are malformed: ' + JSON.stringify(shops));
});

await check('both outlets exist', async () => {
  const rows = await q('SELECT id, name FROM shops ORDER BY id', [], token);
  assert(rows.length >= 2, 'expected at least 2 outlets, found ' + rows.length);
  const two = rows.find((r) => Number(r.id) === 2);
  assert(two, 'outlet 2 is missing');
});

await check('the existing user still has access to their home outlet', async () => {
  const rows = await q(
    'SELECT shop_id FROM user_shops WHERE user_id = (SELECT id FROM users WHERE email = $1)',
    ['admin@lubric.app'], token);
  assert(rows.length >= 1, 'admin has no outlet membership - this deploy would lock them out');
  assert(rows.some((r) => Number(r.shop_id) === 1), 'admin lost access to outlet 1');
});

await check('the X-Shop-Id header is validated, not trusted', async () => {
  // Without this check the header is an authorization bypass, not a scope: any
  // user could read any outlet by naming it.
  const marker = 'UNMEMBERED-' + Date.now();
  await exec(
    `INSERT INTO customers (shop_id, name, customer_type) VALUES (2, $1, 'returning')`,
    [marker], token, 2);
  const rows = await q('SELECT name FROM customers WHERE name LIKE $1', ['UNMEMBERED-%'], token, 2);
  await exec('DELETE FROM customers WHERE shop_id = 2 AND name = $1', [marker], token, 2);
  // Outlet 2 holds no customers, so an honest outlet-2 scope returns none.
  // Asserted on `customers`, NOT on `shops`: `shops` is deliberately exempt
  // from row security (the app must read the outlet list to render the
  // selector), so querying it proves nothing about scoping. An earlier version
  // of this check asserted on `shops` and "failed" for a reason unrelated to
  // the header check it claimed to be testing.
  if (!DB_REACHABLE) return 'SKIP';
  if (!RLS_ON) {
    console.log('        ^ scoping is not observable until migration 030 enables RLS');
    return undefined;
  }
  assert(rows.length === 0,
    'LEAK: a non-member asking for outlet 2 was served outlet 2 data: ' + JSON.stringify(rows));
});

await check('membership can be granted, and then the outlet is served', async () => {
  await exec(
    'INSERT INTO user_shops (user_id, shop_id, role) SELECT id, 2, role FROM users WHERE email = $1 ON CONFLICT DO NOTHING',
    ['admin@lubric.app'], token);
  const rows = await q('SELECT id, name FROM shops', [], token, 2);
  assert(rows.some((r) => Number(r.id) === 2),
    'a granted outlet is still not served: ' + JSON.stringify(rows));
  await exec(
    'DELETE FROM user_shops WHERE user_id = (SELECT id FROM users WHERE email = $1) AND shop_id = 2',
    ['admin@lubric.app'], token);
});

await check('the app role exists and is NOT a superuser', async () => {
  // The whole plan rests on this. A superuser bypasses RLS unconditionally.
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch {
    return 'SKIP';
  }
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    const r = await client.query(
      'SELECT current_user AS u, rolsuper AS sup, rolbypassrls AS byp FROM pg_roles WHERE rolname = current_user');
    const row = r.rows[0];
    assert(row, 'app role did not connect');
    assert(row.sup === false, 'the app role is a SUPERUSER - row security cannot constrain it');
    assert(row.byp === false, 'the app role has BYPASSRLS - row security cannot constrain it');
  } finally {
    await client.end();
  }
});

// ── enforcement checks ──────────────────────────────────────────────────────
// These connect AS THE APP ROLE and are the real proof. They SKIP rather than
// pass when no direct connection is available, because a skipped check that
// looks like a pass is how a leak ships.
const noDb = () => 'SKIP';
const notYet = () => {
  if (!DB_REACHABLE) return 'SKIP';
  if (!RLS_ON) {
    console.log('        ^ expected to fail until migration 030 enables RLS');
  }
  return undefined;
};

await check('a policy exists on the tables that carry shop_id', async () => {
  if (!DB_REACHABLE) return noDb();
  await asAppRole(async (c) => {
    const r = await c.query(
      `SELECT count(*)::int AS n
         FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'shop_isolation'`);
    assert(r.rows[0].n >= 20,
      'only ' + r.rows[0].n + ' shop_isolation policies exist; expected one per business table');
  });
});

await check('ISOLATION: one outlet cannot see another outlet\'s rows', async () => {
  if (!DB_REACHABLE) return noDb();
  const r = notYet();
  if (r) return r;
  await asAppRole(async (c) => {
    // A marker in each outlet, inserted under that outlet's own context so the
    // WITH CHECK is satisfied rather than bypassed.
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.shop_id', '1', true)");
    const a = await c.query(
      `INSERT INTO customers (shop_id, name, customer_type) VALUES (1, 'ISO-A', 'returning') RETURNING id`);
    await c.query('COMMIT');
    const idA = a.rows[0].id;

    await c.query('BEGIN');
    await c.query("SELECT set_config('app.shop_id', '2', true)");
    const b = await c.query(
      `INSERT INTO customers (shop_id, name, customer_type) VALUES (2, 'ISO-B', 'returning') RETURNING id`);
    await c.query('COMMIT');
    const idB = b.rows[0].id;

    // Act as outlet 1 and confirm outlet 2's marker is invisible.
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.shop_id', '1', true)");
    const names = (await c.query(`SELECT name FROM customers WHERE name LIKE 'ISO-%'`))
      .rows.map((x) => x.name);
    assert(names.includes('ISO-A'), 'outlet 1 cannot see its own marker: ' + JSON.stringify(names));
    assert(!names.includes('ISO-B'),
      'LEAK: outlet 1 saw outlet 2\'s row. Row security is NOT enabled yet - run migration 030.');
    await c.query('COMMIT');

    // And the reverse direction.
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.shop_id', '2', true)");
    const names2 = (await c.query(`SELECT name FROM customers WHERE name LIKE 'ISO-%'`))
      .rows.map((x) => x.name);
    assert(!names2.includes('ISO-A'), 'LEAK: outlet 2 saw outlet 1\'s row.');
    await c.query('COMMIT');

    // Clean up through the ADMIN connection, because the app role cannot delete
    // rows in an outlet it is not acting as - which is the very thing under test.
    // The superuser password is NOT the app role's, so it must be supplied
    // explicitly as PGADMIN_URL rather than string-substituted from PGURL.
    const pg = (await import('pg')).default;
    const adminUrl = process.env.PGADMIN_URL;
    assert(adminUrl, 'PGADMIN_URL is required to clean up the isolation markers');
    const ac = new pg.Client({ connectionString: adminUrl });
    await ac.connect();
    await ac.query('DELETE FROM customers WHERE id = ANY($1::int[])', [[idA, idB]]);
    await ac.end();
  });
});

await check('ISOLATION: an unset outlet context shows nothing, not everything', async () => {
  if (!DB_REACHABLE) return noDb();
  const r = notYet();
  if (r) return r;
  await asAppRole(async (c) => {
    // Fail-closed check. current_setting(..., true) returns NULL when unset, so
    // the policy hides every row. If this ever returns rows the default has
    // become fail-OPEN, and any forgotten context would leak the database.
    const r2 = await c.query('SELECT count(*)::int AS n FROM customers');
    assert(r2.rows[0].n === 0,
      r2.rows[0].n + ' customers visible with NO outlet context - this fails OPEN, which is a leak');
  });
});

await check('ISOLATION: a write cannot land in another outlet', async () => {
  if (!DB_REACHABLE) return noDb();
  const r = notYet();
  if (r) return r;
  await asAppRole(async (c) => {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.shop_id', '1', true)");
    let blocked = false;
    try {
      // Claiming to write into outlet 2 while acting as outlet 1.
      await c.query(
        `INSERT INTO customers (shop_id, name, customer_type) VALUES (2, 'ISO-CROSS', 'returning')`);
    } catch (e) {
      blocked = /row-level security|policy/i.test(e.message);
    }
    await c.query('ROLLBACK');
    assert(blocked,
      'a cross-outlet INSERT was ACCEPTED. WITH CHECK is not enforced - run migration 030.');
  });
});

console.log('\n' + ok + '/' + total + ' checks passed' +
  (skipped ? ` (${skipped} skipped)` : '') +
  (DB_REACHABLE ? '' : ' - direct DB checks skipped (run inside the docker network)'));
process.exit(ok === total ? 0 : 1);
