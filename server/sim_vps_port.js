/**
 * VPS port sim — the three server pieces that lived only on the VPS
 * (2026-11-21) and are now ported into server/index.js, so the coming
 * VPS redeploy does not regress them:
 *
 *  1. POST /api/auth/login parses user.permissions before returning it.
 *  2. GET /api/auth/me parses permissions on the returned user row.
 *  3. POST /api/auth/demo mints a session for demo@umarjamal.demo,
 *     guarded to shop 4 + cashier, user returned without password_hash.
 *
 * Why it matters: users.permissions is a TEXT column holding a JSON string,
 * so the raw value is NEVER an array. The frontend's permission gate does
 * `parsePermissions(user.permissions)` — but only if the server hands it a
 * parsed array. Before this port, login/me returned the raw TEXT string and
 * a non-admin saw an empty sidebar (the cashier bug of 2026-11-24).
 *
 * The sim never starts the server and never touches any database: it runs
 * the REAL parsePermissions extracted from server/index.js, checks the
 * ported handlers' source placement, and evaluates the demo guard's exact
 * condition against shop/role cases.
 *
 * Run:  node server/sim_vps_port.js
 */

import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

let ok = 0, total = 0, failed = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { failed++; console.log(`FAIL - ${title}: ${e.message}`); }
}
function eq(a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`expected ${sb}, got ${sa}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ── extract the REAL parsePermissions from server/index.js ────────────────
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert(start !== -1, `${name} not found in server/index.js`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert(depth === 0, `could not match braces for ${name}`);
  return src.slice(start, i + 1);
}
const parsePermissions = new Function(`return (${extractFunction(SRC, 'parsePermissions')})`)();

// Handler regions, in file order.
const loginRegion = SRC.slice(
  SRC.indexOf("app.post('/api/auth/login'"),
  SRC.indexOf('// ─── Auth: Me')
);
assert(loginRegion.length > 0, 'login region not found');
const demoRegion = SRC.slice(
  SRC.indexOf("app.post('/api/auth/demo'"),
  SRC.indexOf("app.get('/api/auth/me'")
);
assert(demoRegion.length > 0, 'demo region not found');
const meRegion = SRC.slice(
  SRC.indexOf("app.get('/api/auth/me'"),
  SRC.indexOf('// ─── Which outlet')
);
assert(meRegion.length > 0, 'me region not found');

// (a) Login returns permissions as an ARRAY, not the raw TEXT string.
check('login parses permissions before responding', () => {
  const parseAt = loginRegion.indexOf('user.permissions = parsePermissions(user.permissions);');
  const jsonAt = loginRegion.indexOf('res.json({ token, user, shops: outlets.rows });');
  assert(parseAt !== -1, 'login handler has no permissions parse');
  assert(jsonAt !== -1, 'login res.json not found');
  assert(parseAt < jsonAt, 'login parse must sit before res.json');
});
check('parsePermissions turns the TEXT column into an array', () => {
  eq(
    parsePermissions('["dashboard","pos.create","sales_history","customers"]'),
    ['dashboard', 'pos.create', 'sales_history', 'customers']
  );
});
check('parsePermissions handles empty and already-parsed values', () => {
  eq(parsePermissions('[]'), []);
  eq(parsePermissions(null), []);
  eq(parsePermissions(['dashboard', 'pos.create']), ['dashboard', 'pos.create']);
});

// (b) /me returns parsed permissions.
check('/me parses permissions on the returned row', () => {
  assert(meRegion.includes('const meUser = result.rows[0];'), '/me has no meUser row');
  assert(
    meRegion.includes('meUser.permissions = parsePermissions(meUser.permissions);'),
    '/me does not parse permissions'
  );
  assert(meRegion.includes('res.json({ user: meUser });'), '/me does not return meUser');
  assert(!meRegion.includes('res.json({ user: result.rows[0] });'), '/me still returns the raw row');
});

// (c) Demo endpoint exists, guarded, password-free.
check('demo endpoint exists between login and /me', () => {
  assert(SRC.indexOf("app.post('/api/auth/demo'") !== -1, 'no /api/auth/demo route');
  assert(
    SRC.indexOf("app.post('/api/auth/demo'") < SRC.indexOf("app.get('/api/auth/me'"),
    'demo route is not before /me'
  );
  assert(demoRegion.includes("'demo@umarjamal.demo'"), 'demo route targets the wrong account');
});
check('demo SELECT omits password_hash', () => {
  const sel = demoRegion.slice(0, demoRegion.indexOf("['demo@umarjamal.demo']"));
  assert(sel.includes('SELECT id, shop_id, email, full_name, role, permissions, created_at'), 'demo SELECT shape changed');
  assert(!sel.includes('password_hash'), 'demo SELECT leaks password_hash');
});
check('demo guard rejects a non-demo shop or role', () => {
  const m = demoRegion.match(/if \((user\.shop_id !== 4 \|\| user\.role !== 'cashier')\)/);
  assert(m, 'demo guard condition not found verbatim');
  const guardFires = new Function('user', `return (${m[1]});`);
  assert(guardFires({ shop_id: 1, role: 'cashier' }) === true, 'shop 1 cashier must be rejected');
  assert(guardFires({ shop_id: 4, role: 'admin' }) === true, 'shop 4 admin must be rejected');
  assert(guardFires({ shop_id: 5, role: 'owner' }) === true, 'shop 5 owner must be rejected');
  assert(guardFires({ shop_id: 4, role: 'cashier' }) === false, 'shop 4 cashier must pass');
});
check('demo response parses permissions and matches the login shape', () => {
  assert(demoRegion.includes('user.permissions = parsePermissions(user.permissions);'), 'demo does not parse permissions');
  assert(demoRegion.includes('res.json({ token, user, shops: outlets.rows });'), 'demo response shape changed');
});

console.log(`\n${ok}/${total} checks passed${failed ? ` — ${failed} FAILED` : ''}`);
if (failed) process.exit(1);
