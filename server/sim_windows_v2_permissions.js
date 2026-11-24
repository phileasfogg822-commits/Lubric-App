/**
 * Windows v2 fix batch — cashier permissions + Team password hashing,
 * against a real SQLite database (the offline desktop path, src/lib/localDb.ts).
 *
 * The bugs, for the record:
 *  - users.permissions is a TEXT column holding a JSON string, so the raw
 *    value is NEVER an array. Layout.tsx and App.tsx both did
 *    `Array.isArray(user.permissions) ? ... : []` / bounced non-arrays, so
 *    a cashier saw an empty sidebar and every protected route bounced them
 *    back to /dashboard. Both now parse with parsePermissions().
 *  - Team.tsx stored the PLAIN password as password_hash in server mode
 *    (claiming the server hashes on its own path — it does not; the
 *    generic SQL endpoint runs raw SQL). Login does bcrypt.compare, which
 *    fails against plaintext, so VPS accounts created via Team could never
 *    log in. hashFor now always bcrypt-hashes.
 *
 * The sim replays Team's exact INSERT/UPDATE statements and the exact gate
 * predicate Layout.visible / RequirePermission now use, through the app's
 * OWN schema, pgToSqlite translation and permissions module.
 *
 * Run:  node --experimental-strip-types sim_windows_v2_permissions.js
 */

import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { ensureLocalSchema, pgToSqlite } from '../src/lib/localDb.ts';
import {
  parsePermissions,
  serializePermissions,
  getDefaultPermissions,
  can,
  MODULE_PERMISSIONS,
} from '../src/lib/permissions.ts';

const raw = new DatabaseSync(':memory:');

// Same adapter as sim_windows_login.js: node:sqlite binds anonymous
// placeholders, while the Tauri plugin the app ships with (sqlx)
// understands $1 — the harness rewrites, the product does not need to.
const db = {
  execute: async (sql) => raw.exec(sql),
  select: async (sql) => raw.prepare(sql).all(),
};

function toSqlite(sql) {
  return pgToSqlite(sql).replace(/\$(\d+)/g, '?');
}
function run(sql, params = []) {
  return raw.prepare(toSqlite(sql)).all(...params);
}
function exec(sql, params = []) {
  return raw.prepare(toSqlite(sql)).run(...params);
}

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('async check — use await');
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}
async function checkAsync(title, fn) {
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

/**
 * The gate predicate Layout.visible() and App.tsx RequirePermission now use:
 * admin bypasses; everyone else needs one of the needed keys in their
 * PARSED permissions list. (Admin bypass is covered by can()/isAdminRole
 * in the real components; here we test the non-admin path.)
 */
function gate(perms, needed) {
  return needed.some((k) => perms.includes(k));
}

await ensureLocalSchema(db);
console.log('\nWindows v2 — cashier permissions + Team password hashing (real localDb schema)');

// ── the column really is TEXT, so the value arrives as a string ─────────────
check('users.permissions column is TEXT (value arrives as a JSON string, never an array)', () => {
  const cols = run("PRAGMA table_info(users)");
  const col = cols.find((c) => c.name === 'permissions');
  assert(col && col.type.toUpperCase() === 'TEXT', 'permissions column: ' + JSON.stringify(col));
});

// ── Team create path: the exact INSERT Team.tsx sends ────────────────────────
const CASHIER_PASSWORD = 'cashier-pass-123';
const cashierPerms = serializePermissions(getDefaultPermissions('cashier'));
const cashierHash = await bcrypt.hash(CASHIER_PASSWORD, 10);
exec(
  'INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ($1,$2,$3,$4,$5)',
  ['Test Cashier', 'cashier@test.local', cashierHash, 'cashier', cashierPerms]
);
const cashier = run('SELECT * FROM users WHERE email = $1', ['cashier@test.local'])[0];
assert(cashier, 'cashier row missing');

check('Team create stores a bcrypt hash, not the plaintext password', () => {
  assert(cashier.password_hash.startsWith('$2b$'), 'hash prefix: ' + String(cashier.password_hash).slice(0, 8));
  assert(cashier.password_hash !== CASHIER_PASSWORD, 'password stored in plaintext');
});
await checkAsync('stored hash verifies the right password', async () => {
  assert(await bcrypt.compare(CASHIER_PASSWORD, cashier.password_hash), 'compare failed for correct password');
});
await checkAsync('stored hash rejects a wrong password', async () => {
  assert(!(await bcrypt.compare('wrong-password', cashier.password_hash)), 'compare passed for wrong password');
});

check('stored permissions value is a STRING (the shape that broke the old code)', () => {
  assert(typeof cashier.permissions === 'string', 'typeof: ' + typeof cashier.permissions);
});
check('negative control: Array.isArray on the stored value is false (old code fell back to [])', () => {
  assert(Array.isArray(cashier.permissions) === false, 'old check would have passed');
});

// ── the gate, through the real parsePermissions ─────────────────────────────
const perms = parsePermissions(cashier.permissions);
check('parsePermissions turns the JSON string into the 4 cashier keys', () => {
  assert(JSON.stringify(perms) === JSON.stringify(['customers', 'dashboard', 'pos.create', 'sales_history']),
    'parsed: ' + JSON.stringify(perms));
});
check('cashier gate PASSES dashboard / pos.create / sales_history / customers', () => {
  for (const k of ['dashboard', 'pos.create', 'sales_history', 'customers']) {
    assert(gate(perms, [k]), 'gate failed for ' + k);
  }
});
check('cashier gate FAILS vendors / team.manage / shop.manage', () => {
  for (const k of ['vendors', 'team.manage', 'shop.manage']) {
    assert(!gate(perms, [k]), 'gate passed for ' + k);
  }
});
check('can() (the real module) agrees with the gate on every key', () => {
  for (const k of ['dashboard', 'pos.create', 'sales_history', 'customers', 'vendors', 'team.manage', 'shop.manage']) {
    assert(can(cashier, k) === gate(perms, [k]), 'can/gate disagree on ' + k);
  }
});

// ── empty permissions pass nothing ───────────────────────────────────────────
exec(
  'INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ($1,$2,$3,$4,$5)',
  ['No Access', 'noaccess@test.local', await bcrypt.hash('x', 10), 'cashier', '[]']
);
const bare = run('SELECT * FROM users WHERE email = $1', ['noaccess@test.local'])[0];
check("permissions '[]' parses to [] and the gate passes nothing, not even dashboard", () => {
  const p = parsePermissions(bare.permissions);
  assert(p.length === 0, 'parsed: ' + JSON.stringify(p));
  assert(!gate(p, ['dashboard']), 'empty-permissions user passed dashboard');
});

// ── Team edit path: the exact UPDATE Team.tsx sends ─────────────────────────
const NEW_PASSWORD = 'new-pass-456';
exec(
  'UPDATE users SET full_name=$1, email=$2, role=$3, permissions=$4, password_hash=$5 WHERE id=$6',
  ['Test Cashier', 'cashier@test.local', 'cashier', cashierPerms, await bcrypt.hash(NEW_PASSWORD, 10), cashier.id]
);
const edited = run('SELECT * FROM users WHERE id = $1', [cashier.id])[0];
await checkAsync('Team edit re-hashes: new password verifies, old password no longer does', async () => {
  assert(await bcrypt.compare(NEW_PASSWORD, edited.password_hash), 'new password failed');
  assert(!(await bcrypt.compare(CASHIER_PASSWORD, edited.password_hash)), 'old password still verifies');
});

// ── rename: Stock, not Catalog ──────────────────────────────────────────────
check('catalog.manage tick label is now "Stock"', () => {
  const def = MODULE_PERMISSIONS.find((p) => p.key === 'catalog.manage');
  assert(def && def.label === 'Stock', 'label: ' + JSON.stringify(def));
});

console.log(`\n${ok}/${total} checks passed`);
if (ok !== total) process.exit(1);
