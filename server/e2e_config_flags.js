/**
 * Proves the config & feature-flag API (migration 034) end to end.
 *
 * unit-level correctness of the SQL is trivial (it is INSERTs); what can break
 * silently is the VISIBILITY contract:
 *
 *  - branding keys must be readable pre-login so the white-label login screen
 *    can render app_name / primary_color, while payment_gateway, DB env and
 *    the module manifest stay behind auth + shop.manage;
 *  - flags must be readable by any session (nav gating runs for cashiers too)
 *    but writable only by admin/owner;
 *  - the /api/query SQL path must agree with the REST path — the same lesson
 *    e2e_pairing.js documents for `devices`: an unlisted table is ALLOWED by
 *    default, so `config`/`feature_flags` have to be in the permission maps.
 *
 * Run:  node e2e_config_flags.js
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
async function get(path, token) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method: 'GET', headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function patch(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method: 'PATCH', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function q(sql, params, token) {
  const { status, body } = await post('/api/query', { sql, params }, token);
  return { status, body };
}
async function exec(sql, params, token) {
  return post('/api/execute', { sql, params }, token);
}
async function auth(email, pass) {
  const { status, body } = await post('/api/auth/login', { email, password: pass });
  if (status !== 200) throw new Error('auth failed: ' + status);
  return body.token;
}

console.log('\nConfig & feature flags (034)');

const atok = await auth('admin@lubric.app', 'admin123');
let ctok = null;
try {
  ctok = await auth('cashier@lubric.app', 'cashier123');
} catch {
  console.log('  (no cashier user - skipping the cashier guard checks)');
}

const BRANDING = ['app_name', 'primary_color', 'default_branding'];
const SECRET = ['payment_gateway', 'db_environment', 'api_endpoint', 'support_email', 'support_phone', 'included_modules'];
const EXPECTED_CONFIG = ['app_name', 'primary_color', 'api_endpoint', 'db_environment', 'payment_gateway', 'support_email', 'support_phone', 'included_modules', 'default_branding'];
const EXPECTED_FLAGS = ['dashboard', 'pos.create', 'sales_history', 'catalog.manage', 'customers', 'vendors', 'accounts', 'expenses.manage', 'purchase.manage', 'inspections', 'reports', 'profit_loss', 'team.manage', 'shop.manage'];

await check('migration 034 seeded every Level A config key', async () => {
  const { status, body } = await get('/api/config', atok);
  assert(status === 200, 'status ' + status);
  const keys = new Set(body.map((r) => r.key));
  const missing = EXPECTED_CONFIG.filter((k) => !keys.has(k));
  assert(missing.length === 0, 'missing keys: ' + missing.join(', '));
});

await check('migration 034 seeded all 14 feature flags, enabled and global', async () => {
  const { status, body } = await get('/api/feature-flags', atok);
  assert(status === 200, 'status ' + status);
  const keys = new Set(body.map((r) => r.key));
  const missing = EXPECTED_FLAGS.filter((k) => !keys.has(k));
  assert(missing.length === 0, 'missing flags: ' + missing.join(', '));
  const off = body.filter((r) => r.enabled !== true);
  assert(off.length === 0, 'flags not enabled by default: ' + JSON.stringify(off.map((r) => r.key)));
  const scoped = body.filter((r) => r.shop_id !== null);
  assert(scoped.length === 0, 'seed rows should be global (shop_id NULL): ' + JSON.stringify(scoped));
});

await check('included_modules parses as a JSON array with the core modules', async () => {
  const { body } = await get('/api/config', atok);
  const row = body.find((r) => r.key === 'included_modules');
  assert(row, 'no included_modules row');
  let list;
  try {
    list = JSON.parse(row.value);
  } catch (e) {
    throw new Error('not valid JSON: ' + e.message);
  }
  assert(Array.isArray(list), 'not an array');
  for (const m of ['dashboard', 'pos.create', 'reports', 'catalog.manage']) {
    assert(list.includes(m), 'core module missing from manifest: ' + m);
  }
});

await check('unauthenticated /api/config exposes branding keys only', async () => {
  const { status, body } = await get('/api/config');
  assert(status === 200, 'status ' + status);
  assert(Array.isArray(body), 'expected an array');
  const keys = new Set(body.map((r) => r.key));
  for (const k of BRANDING) assert(keys.has(k), 'branding key missing: ' + k);
  for (const k of SECRET) assert(!keys.has(k), 'secret key leaked pre-login: ' + k);
});

await check('unauthenticated /api/config?key=payment_gateway leaks nothing', async () => {
  const { status, body } = await get('/api/config?key=payment_gateway');
  assert(status === 200, 'status ' + status);
  assert(Array.isArray(body) && body.length === 0, 'row returned without auth: ' + JSON.stringify(body));
});

await check('unauthenticated /api/config/:key allows branding, rejects secrets', async () => {
  const good = await get('/api/config/app_name');
  assert(good.status === 200, 'app_name status ' + good.status);
  assert(typeof good.body.value === 'string' && good.body.value.length > 0, 'app_name empty');
  const bad = await get('/api/config/payment_gateway');
  assert(bad.status === 401, 'payment_gateway status ' + bad.status + ', expected 401');
});

await check('unauthenticated /api/feature-flags is rejected', async () => {
  const { status } = await get('/api/feature-flags');
  assert(status === 401, 'status ' + status + ', expected 401');
});

await check('unauthenticated /api/feature-flags/:key is rejected', async () => {
  const { status } = await get('/api/feature-flags/dashboard');
  assert(status === 401, 'status ' + status + ', expected 401');
});

await check('authenticated admin reads the full config', async () => {
  const { status, body } = await get('/api/config', atok);
  assert(status === 200, 'status ' + status);
  const keys = new Set(body.map((r) => r.key));
  for (const k of SECRET) assert(keys.has(k), 'admin cannot see ' + k);
});

await check('authenticated session reads every feature flag', async () => {
  const { status, body } = await get('/api/feature-flags', atok);
  assert(status === 200, 'status ' + status);
  assert(body.length === EXPECTED_FLAGS.length,
    'got ' + body.length + ' flags, expected ' + EXPECTED_FLAGS.length);
});

await check('unauthenticated PATCH is rejected on both routes', async () => {
  const c = await patch('/api/config/app_name', { value: 'x' });
  assert(c.status === 401, 'config PATCH status ' + c.status + ', expected 401');
  const f = await patch('/api/feature-flags/dashboard', { enabled: false });
  assert(f.status === 401, 'flag PATCH status ' + f.status + ', expected 401');
  // Prove the rejected PATCH changed nothing.
  const after = await get('/api/config/app_name');
  assert(after.status === 200 && after.body.value !== 'x', 'unauthenticated PATCH mutated config');
});

await check('admin flag toggle round-trips and restores the original value', async () => {
  const before = await get('/api/feature-flags/inspections', atok);
  assert(before.status === 200, 'read status ' + before.status);
  const original = before.body.enabled;
  try {
    const flipped = await patch('/api/feature-flags/inspections', { enabled: !original }, atok);
    assert(flipped.status === 200, 'PATCH status ' + flipped.status);
    assert(flipped.body.enabled === !original, 'PATCH echoed wrong value');
    const readBack = await get('/api/feature-flags/inspections', atok);
    assert(readBack.body.enabled === !original, 'read-back did not show the toggle');
  } finally {
    await patch('/api/feature-flags/inspections', { enabled: original }, atok);
  }
  const restored = await get('/api/feature-flags/inspections', atok);
  assert(restored.body.enabled === original, 'flag not restored (was ' + original + ')');
});

await check('PATCH upserts unknown keys and cleanup removes them', async () => {
  try {
    const c = await patch('/api/config/_e2e_cfg_probe', { value: 'x' }, atok);
    assert(c.status === 200 && c.body.value === 'x', 'config upsert: ' + c.status + ' ' + JSON.stringify(c.body));
    const f = await patch('/api/feature-flags/_e2e_flag_probe', { enabled: false }, atok);
    assert(f.status === 200 && f.body.enabled === false, 'flag upsert: ' + f.status + ' ' + JSON.stringify(f.body));
    const g = await get('/api/config/_e2e_cfg_probe', atok);
    assert(g.status === 200 && g.body.value === 'x', 'probe not readable after upsert');
  } finally {
    await exec('DELETE FROM config WHERE key = $1', ['_e2e_cfg_probe'], atok);
    await exec('DELETE FROM feature_flags WHERE key = $1', ['_e2e_flag_probe'], atok);
  }
  const gone1 = await get('/api/config/_e2e_cfg_probe', atok);
  assert(gone1.status === 404, 'config probe left behind (status ' + gone1.status + ')');
  const gone2 = await get('/api/feature-flags/_e2e_flag_probe', atok);
  assert(gone2.status === 404, 'flag probe left behind (status ' + gone2.status + ')');
});

if (ctok) {
  await check('cashier REST config read is branding-only', async () => {
    const { status, body } = await get('/api/config', ctok);
    assert(status === 200, 'status ' + status);
    const keys = new Set(body.map((r) => r.key));
    for (const k of SECRET) assert(!keys.has(k), 'cashier can see ' + k + ' over REST');
    assert(keys.has('app_name'), 'cashier lost branding access');
  });

  await check('cashier single secret config key is rejected', async () => {
    const { status } = await get('/api/config/payment_gateway', ctok);
    assert(status === 403, 'status ' + status + ', expected 403');
  });

  await check('cashier cannot read config via /api/query (SQL guard)', async () => {
    const { status } = await q('SELECT key, value FROM config', [], ctok);
    assert(status === 403, 'status ' + status + ', expected 403 - table missing from permission map?');
  });

  await check('cashier cannot write feature_flags via /api/execute (SQL guard)', async () => {
    const { status } = await exec('UPDATE feature_flags SET enabled = $1 WHERE key = $2', [false, 'dashboard'], ctok);
    assert(status === 403, 'status ' + status + ', expected 403 - table missing from permission map?');
    // Belt and braces: if the guard failed, put it back before failing.
    if (status === 200) {
      await exec('UPDATE feature_flags SET enabled = $1 WHERE key = $2', [true, 'dashboard'], atok);
    }
  });

  await check('cashier can read flags over REST (nav gating needs them)', async () => {
    const { status, body } = await get('/api/feature-flags', ctok);
    assert(status === 200, 'status ' + status);
    assert(body.length === EXPECTED_FLAGS.length, 'got ' + body.length + ' flags');
  });

  await check('cashier cannot PATCH flags (admin only)', async () => {
    const { status } = await patch('/api/feature-flags/dashboard', { enabled: false }, ctok);
    assert(status === 403, 'status ' + status + ', expected 403');
  });
}

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);