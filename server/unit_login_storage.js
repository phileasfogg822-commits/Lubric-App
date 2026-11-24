/**
 * Login storage — passwords must never be saved (reported 2026-11-24).
 *
 * What this pins down:
 *  - src/lib/loginMemory.ts remembers EMAILS ONLY (most recent first,
 *    de-duplicated, capped) and blanks password_hash before a user row is
 *    persisted — exercised here against a localStorage shim.
 *  - Code-level assertions on the real sources: no localStorage /
 *    sessionStorage write anywhere in src/ carries a password value, the
 *    auth provider stores the stripped user and remembers only the email,
 *    and the login form tells the browser not to remember the password
 *    (autoComplete="new-password" + form autoComplete="off").
 *  - The ?demo=1 auto-login in index.html is untouched by the login change.
 *
 * Run:  node --experimental-strip-types server/unit_login_storage.js
 * (also picked up by the CI unit loop: server/unit_*.js)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getRememberedEmails, rememberEmail, stripPasswordHash } from '../src/lib/loginMemory.ts';

// ── a localStorage shim, installed before any loginMemory call ─────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try {
    fn();
    ok++;
    console.log(`ok - ${title}`);
  } catch (e) {
    console.log(`FAIL - ${title}: ${e.message}`);
  }
}
function eq(a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`expected ${sb}, got ${sa}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ── loginMemory behaviour ──────────────────────────────────────────────────
check('remembered emails start empty', () => {
  store.clear();
  eq(getRememberedEmails(), []);
});

check('rememberEmail keeps most-recent-first, de-duplicated, capped at 6', () => {
  store.clear();
  rememberEmail('Worker@Example.com');
  rememberEmail('admin@lubric.app');
  rememberEmail('worker@example.com');
  eq(getRememberedEmails(), ['worker@example.com', 'admin@lubric.app']);
  for (let i = 0; i < 8; i++) rememberEmail(`user${i}@example.com`);
  const list = getRememberedEmails();
  assert(list.length === 6, 'expected cap of 6, got ' + list.length);
  assert(list[0] === 'user7@example.com', 'newest first, got ' + list[0]);
  assert(!list.includes('worker@example.com'), 'oldest must have fallen off');
});

check('rememberEmail stores emails only — no password-shaped value lands', () => {
  store.clear();
  rememberEmail('cashier@lubric.app');
  const raw = store.get('lubric_remembered_emails') ?? '';
  assert(!/pass/i.test(raw), 'remembered value mentions a password: ' + raw);
  assert(raw.includes('cashier@lubric.app'), 'email missing: ' + raw);
});

check('getRememberedEmails tolerates corrupt storage', () => {
  store.set('lubric_remembered_emails', '{not json');
  eq(getRememberedEmails(), []);
  store.set('lubric_remembered_emails', '"just a string"');
  eq(getRememberedEmails(), []);
});

check('stripPasswordHash blanks the hash and keeps everything else', () => {
  const user = {
    id: 4, email: 'worker1@gmail.com', password_hash: '$2b$10$abc',
    full_name: 'Worker One', role: 'cashier', permissions: ['pos.create'],
  };
  const clean = stripPasswordHash(user);
  assert(clean.password_hash === '', 'hash not blanked: ' + clean.password_hash);
  assert(clean.email === 'worker1@gmail.com' && clean.role === 'cashier', 'other fields changed');
  assert(clean.permissions[0] === 'pos.create', 'permissions lost');
  assert(user.password_hash === '$2b$10$abc', 'input row must not be mutated');
});

// ── code-level assertions on the real sources ─────────────────────────────
const ROOT = new URL('..', import.meta.url).pathname;
function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}
function allSrcFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) allSrcFiles(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

check('no storage write anywhere in src/ carries a password value', () => {
  const offenders = [];
  for (const file of allSrcFiles(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const line of src.split('\n')) {
      if (
        /(localStorage|sessionStorage)\s*\.\s*setItem/.test(line) &&
        /password/i.test(line)
      ) {
        offenders.push(`${file.split('lubric-app/')[1]}: ${line.trim()}`);
      }
    }
  }
  assert(offenders.length === 0, 'password in a storage write:\n' + offenders.join('\n'));
});

check('auth.tsx stores the stripped user and remembers only the email', () => {
  const src = read('src/lib/auth.tsx');
  assert(src.includes('setUser(stripPasswordHash('), 'no stripped setUser in auth.tsx');
  assert(src.includes('rememberEmail(email)'), 'login does not remember the email');
  assert(!src.includes('localStorage.setItem(STORAGE_KEY, JSON.stringify(user))') || src.includes('stripPasswordHash'), 'persist effect may store a raw user');
});

check('Login.tsx tells the browser not to remember the password', () => {
  const src = read('src/modules/auth/Login.tsx');
  assert(src.includes('autoComplete="new-password"'), 'password field lacks autoComplete="new-password"');
  assert(src.includes('autoComplete="username"'), 'email field lacks autoComplete="username"');
  assert(src.includes('<form onSubmit={handleSubmit} autoComplete="off">'), 'form lacks autoComplete="off"');
  assert(!src.includes('autoComplete="current-password"'), 'current-password autocomplete present');
});

check('Login.tsx offers user boxes from remembered emails / local users', () => {
  const src = read('src/modules/auth/Login.tsx');
  assert(src.includes('getRememberedEmails()'), 'no remembered-emails picker');
  assert(src.includes('SELECT email, full_name FROM users'), 'no local-users picker for Tauri');
  assert(src.includes('Use a different email'), 'no way back to a fresh email');
  assert(src.includes('setPassword("")'), 'picking a user must clear the password field');
});

check('?demo=1 auto-login in index.html is untouched', () => {
  const src = read('index.html');
  assert(src.includes('/api/auth/demo'), 'demo endpoint missing from index.html');
  assert(src.includes('demo'), 'demo handling missing from index.html');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
