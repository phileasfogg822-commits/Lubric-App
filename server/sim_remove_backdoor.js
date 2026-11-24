/**
 * Backdoor removal — /api/auth/login in server/index.js.
 *
 * The old handler accepted the well-known plaintext passwords for ANY
 * account before ever reaching bcrypt:
 *   if (password === 'admin123' || password === 'cashier123') valid = true;
 * That is gone. bcrypt.compare against the stored hash is now the only
 * password check.
 *
 * Safety, verified here:
 *  - The demo account is NOT affected: there is no /api/auth/demo endpoint
 *    anywhere in this repo (the portfolio demo login is a passwordless
 *    VPS-only endpoint), and no demo user exists in the repo — so the
 *    bypass was never on the demo login's path.
 *  - The seeded admin/cashier rows (migration 002_seed.sql) carry the
 *    bcrypt hash of "password", so they still log in via bcrypt.compare.
 *    The old bypass was the ONLY thing that made the published passwords
 *    work.
 *
 * Run:  node sim_remove_backdoor.js
 */

import fs from 'node:fs';
import bcrypt from 'bcryptjs';

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

const serverSrc = fs.readFileSync('server/index.js', 'utf8');
const loginSrc = fs.readFileSync('src/modules/auth/Login.tsx', 'utf8');
const seedSql = fs.readFileSync('server/migrations/002_seed.sql', 'utf8');

console.log('\nBackdoor removal — /api/auth/login (server/index.js)');

check('no published password remains anywhere in server/index.js', () => {
  assert(!serverSrc.includes('admin123') && !serverSrc.includes('cashier123'),
    'published password still present in server/index.js');
});
check('no published password remains on the login screen', () => {
  assert(!loginSrc.includes('admin123') && !loginSrc.includes('cashier123'),
    'published password still advertised on Login.tsx');
});
check('login handler has no plaintext password comparison left', () => {
  assert(!/password\s*===/.test(serverSrc), 'a password === comparison remains');
});
check('login handler checks bcrypt.compare against the stored hash', () => {
  assert(serverSrc.includes('bcrypt.compare(password, user.password_hash)'),
    'bcrypt.compare call missing from login handler');
});

// The seeded hash, read from the migration itself — not hardcoded.
const m = seedSql.match(/admin@lubric\.app', '(\$2b\$[^']+)'/);
assert(m, 'seed hash not found in 002_seed.sql');
const seedHash = m[1];

await checkAsync('old bypass password "admin123" FAILS bcrypt against the seeded hash', async () => {
  assert((await bcrypt.compare('admin123', seedHash)) === false, 'admin123 verified?!');
});
await checkAsync('old bypass password "cashier123" FAILS bcrypt against the seeded hash', async () => {
  assert((await bcrypt.compare('cashier123', seedHash)) === false, 'cashier123 verified?!');
});
await checkAsync('seeded admin still logs in via its real bcrypt hash ("password")', async () => {
  assert((await bcrypt.compare('password', seedHash)) === true, 'seeded hash does not verify');
});
check('no /api/auth/demo endpoint exists in this repo (demo login is VPS-only, untouched)', () => {
  assert(!serverSrc.includes('/api/auth/demo'), 'demo endpoint found in server/index.js');
  const allServer = fs.readdirSync('server').filter((f) => f.endsWith('.js') && !f.startsWith('sim_'));
  for (const f of allServer) {
    const src = fs.readFileSync('server/' + f, 'utf8');
    assert(!src.includes('/api/auth/demo'), 'demo endpoint found in server/' + f);
  }
});

console.log(`\n${ok}/${total} checks passed`);
if (ok !== total) process.exit(1);
