/**
 * Windows standalone login + first-run setup, against a real SQLite
 * database — the offline desktop path (src/lib/localDb.ts).
 *
 * A fresh install has an EMPTY users table, so first-run setup must create
 * the owner (bcrypt hash, never plaintext) and rename the shop; afterwards
 * login verifies the password against the local users table — the same
 * queries src/lib/auth.tsx loginLocal() and src/modules/auth/FirstRunSetup.tsx
 * send, run through the app's OWN schema and pgToSqlite translation.
 *
 * Run:  node --experimental-strip-types sim_windows_login.js
 */

import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { ensureLocalSchema, pgToSqlite } from '../src/lib/localDb.ts';
import { getDefaultPermissions } from '../src/lib/permissions.ts';

const raw = new DatabaseSync(':memory:');

// Same adapter as e2e_ledger_sqlite.js: node:sqlite binds anonymous
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

await ensureLocalSchema(db);
console.log('\nWindows login + first-run setup (real localDb schema + pgToSqlite)');

check('fresh install has an EMPTY users table (first-run setup is required)', () => {
  const rows = run('SELECT COUNT(*) AS c FROM users');
  assert(Number(rows[0].c) === 0, 'expected 0 users, got ' + rows[0].c);
});

check('fresh install still seeds shop, accounts and drum', () => {
  const shop = run('SELECT name FROM shops WHERE id = 1');
  assert(shop[0].name === 'My Shop', 'shop seed missing: ' + JSON.stringify(shop));
  assert(run('SELECT COUNT(*) AS c FROM accounts')[0].c >= 2, 'accounts seed missing');
});

// ── first-run setup: the exact statements FirstRunSetup.tsx sends ──────────
const OWNER_PASSWORD = 'OwnerPass123';
let ownerHash = '';
await checkAsync('first-run setup creates the owner with a bcrypt hash', async () => {
  ownerHash = await bcrypt.hash(OWNER_PASSWORD, 10);
  assert(ownerHash.startsWith('$2b$10$'), 'hash is not bcrypt: ' + ownerHash.slice(0, 12));
  assert(ownerHash !== OWNER_PASSWORD, 'hash equals the plaintext password');
  exec(
    "INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ($1, $2, $3, 'owner', $4)",
    ['Umar Jamal', 'owner@example.com', ownerHash, JSON.stringify(getDefaultPermissions('owner'))]
  );
  const row = run('SELECT * FROM users WHERE email = $1', ['owner@example.com'])[0];
  assert(row && row.role === 'owner', 'owner row missing/wrong role');
  assert(row.password_hash === ownerHash, 'stored hash is not the bcrypt hash');
});

await checkAsync('first-run setup renames the shop and stores app_name', async () => {
  exec('UPDATE shops SET name = $1 WHERE id = 1', ['Al Madina Lubricants']);
  exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('app_name', $1)", ['Al Madina Lubricants']);
  assert(run('SELECT name FROM shops WHERE id = 1')[0].name === 'Al Madina Lubricants', 'shop not renamed');
  assert(run("SELECT value FROM settings WHERE key = 'app_name'")[0].value === 'Al Madina Lubricants', 'app_name not stored');
});

// ── local login: the exact query + verify auth.tsx loginLocal() runs ───────
async function loginLocal(email, password) {
  const row = run(
    'SELECT id, shop_id, email, password_hash, full_name, role, permissions, created_at FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim()]
  )[0];
  if (!row || !row.password_hash) return false;
  return bcrypt.compare(password, row.password_hash);
}

await checkAsync('local login accepts the correct password', async () => {
  assert((await loginLocal('owner@example.com', OWNER_PASSWORD)) === true, 'correct password rejected');
});
await checkAsync('local login rejects a wrong password', async () => {
  assert((await loginLocal('owner@example.com', 'WrongPass123')) === false, 'wrong password accepted');
});
await checkAsync('local login rejects an unknown email', async () => {
  assert((await loginLocal('nobody@example.com', OWNER_PASSWORD)) === false, 'unknown email accepted');
});
await checkAsync('local login is case-insensitive on email', async () => {
  assert((await loginLocal('OWNER@EXAMPLE.COM', OWNER_PASSWORD)) === true, 'email case mismatch rejected');
});

// ── Team hashing: a member password is stored hashed, never raw ────────────
await checkAsync('team member password is stored as a bcrypt hash', async () => {
  const hash = await bcrypt.hash('WorkerPass123', 10);
  exec(
    'INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ($1,$2,$3,$4,$5)',
    ['Worker One', 'worker@example.com', hash, 'worker', JSON.stringify(getDefaultPermissions('worker'))]
  );
  const row = run('SELECT password_hash FROM users WHERE email = $1', ['worker@example.com'])[0];
  assert(row.password_hash.startsWith('$2b$10$'), 'stored value is not a bcrypt hash');
  assert((await bcrypt.compare('WorkerPass123', row.password_hash)) === true, 'member password does not verify');
});

// ── role presets ───────────────────────────────────────────────────────────
check('accountant preset has the money pages, no till, no team, no bill changes', () => {
  const p = getDefaultPermissions('accountant');
  for (const k of ['dashboard', 'sales_history', 'customers', 'vendors', 'accounts', 'expenses.manage', 'purchase.manage', 'reports', 'profit_loss']) {
    assert(p.includes(k), 'accountant missing ' + k);
  }
  for (const k of ['pos.create', 'team.manage', 'bill.edit', 'bill.void', 'bill.delete']) {
    assert(!p.includes(k), 'accountant must not have ' + k);
  }
});
check('worker preset is counter work only', () => {
  const p = getDefaultPermissions('worker');
  for (const k of ['dashboard', 'pos.create', 'sales_history', 'customers', 'inspections']) {
    assert(p.includes(k), 'worker missing ' + k);
  }
  for (const k of ['accounts', 'reports', 'profit_loss', 'team.manage', 'bill.delete']) {
    assert(!p.includes(k), 'worker must not have ' + k);
  }
});

// ── config: the local settings rows configFlags reads in Tauri ─────────────
check('local settings table serves the branding config rows', () => {
  exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('primary_color', $1)", ['#0F766E']);
  const rows = run('SELECT key, value FROM settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert(map['app_name'] === 'Al Madina Lubricants', 'app_name row missing');
  assert(map['primary_color'] === '#0F766E', 'primary_color row missing');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
