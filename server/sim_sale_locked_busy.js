/**
 * Concurrent-write locking on the local (Windows) database — the 2026-11-24
 * report "error returned from database: (code: 517) database is locked".
 *
 * Cause, from the code: the local DB is rusqlite with NO busy_timeout
 * anywhere (it defaults to 0), so any concurrent write fails instantly.
 * App.tsx mounts <SyncLoop />, which writes every 2 minutes outside any
 * transaction (DELETE FROM sync_outbox, pull upserts, UPDATE sync_state),
 * while a sale holds a write transaction (BEGIN..COMMIT in dbTransaction,
 * src/lib/db.ts) — a prime race in both directions. A second cause fed the
 * same error: getLocal() in src/lib/db.ts assigned the connection AFTER the
 * await, so concurrent callers all saw null and each opened their own
 * connection — one process holding several writers on the same file.
 *
 * The fix (src/lib/db.ts): getLocal() promise-caches the load (one
 * connection per process) and runs `PRAGMA busy_timeout = 5000` on it
 * before the schema DDL, so a colliding write waits up to 5s instead of
 * failing instantly.
 *
 * What is checked:
 *   1. RED: two connections on one file DB — a sale transaction holding the
 *      write lock while the sync loop writes (and the reverse) fails
 *      instantly with exactly "database is locked" (busy_timeout 0).
 *   2. RED: the old assign-after-await loader opens one connection per
 *      concurrent caller (5 calls -> 5 loads); the promise-cached loader
 *      opens one (5 calls -> 1 load, every caller the same connection).
 *   3. GREEN: a writer with PRAGMA busy_timeout = 5000 waits for a
 *      lock held by ANOTHER PROCESS for 2s and then succeeds — the write
 *      lands. A child process holds the lock because node:sqlite is
 *      synchronous and blocks the event loop, so an in-process holder
 *      could never release while the writer waits.
 *   4. Source tie-in: db.ts carries the timeout constant, the pragma, and
 *      the promise cache, and the old assign-after-await shape is gone.
 *
 * Run:  node --experimental-strip-types sim_sale_locked_busy.js
 */

import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const tmp = os.tmpdir();
const dbFile = path.join(tmp, `lubric-sim-busy-${process.pid}.db`);
const marker = dbFile + '.held';
for (const f of [dbFile, marker]) { try { unlinkSync(f); } catch { /* first run */ } }

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try {
    fn();
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}
async function checkAsync(title, fn) {
  total++;
  try { await fn(); ok++; console.log('  PASS ' + title); }
  catch (e) { console.log('  FAIL ' + title + ': ' + e.message); }
}
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}

// The file DB both connections share, with the two writers' tables.
{
  const setup = new DatabaseSync(dbFile);
  setup.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL)');
  setup.exec('CREATE TABLE sync_outbox (id INTEGER PRIMARY KEY, table_name TEXT)');
  setup.prepare("INSERT INTO sync_outbox (id, table_name) VALUES (1, 'orders'), (2, 'order_items')").run();
  setup.close();
}

console.log('\nSale-vs-sync write locking (517)');

// ── 1. RED: busy_timeout 0 fails instantly, both directions ──────────────
check('sale holds the lock, sync write fails instantly with "database is locked"', () => {
  const sale = new DatabaseSync(dbFile);
  const sync = new DatabaseSync(dbFile);
  try {
    sale.exec('BEGIN IMMEDIATE');
    sale.prepare("INSERT INTO orders (id, total) VALUES (1, 100)").run();
    let err = null;
    const t0 = Date.now();
    try { sync.prepare('DELETE FROM sync_outbox').run(); } catch (e) { err = e; }
    const ms = Date.now() - t0;
    assert(err && /database is locked/.test(err.message), 'expected "database is locked", got ' + (err ? err.message : 'no error'));
    assert(ms < 1000, 'busy_timeout 0 must fail fast, took ' + ms + 'ms');
  } finally {
    try { sale.exec('ROLLBACK'); } catch { /* already out */ }
    sale.close();
    sync.close();
  }
});

check('sync holds the lock, sale BEGIN fails instantly too', () => {
  const sale = new DatabaseSync(dbFile);
  const sync = new DatabaseSync(dbFile);
  try {
    sync.exec('BEGIN IMMEDIATE');
    sync.prepare("DELETE FROM sync_outbox WHERE id = 1").run();
    let err = null;
    try { sale.exec('BEGIN IMMEDIATE'); } catch (e) { err = e; }
    assert(err && /database is locked/.test(err.message), 'expected "database is locked", got ' + (err ? err.message : 'no error'));
  } finally {
    try { sync.exec('ROLLBACK'); } catch { /* already out */ }
    sale.close();
    sync.close();
  }
});

// ── 2. RED: the loader race — one connection per concurrent caller ───────
await checkAsync('old loader: 5 concurrent callers open 5 connections', async () => {
  let loads = 0;
  const fakeLoad = async () => { await new Promise((r) => setTimeout(r, 10)); loads++; return { id: loads }; };
  let oldConn = null;
  async function oldGetLocal() {
    if (!oldConn) { oldConn = await fakeLoad(); }
    return oldConn;
  }
  await Promise.all([oldGetLocal(), oldGetLocal(), oldGetLocal(), oldGetLocal(), oldGetLocal()]);
  assert(loads === 5, 'the old assign-after-await loader must load once per caller, got ' + loads);
});

await checkAsync('new loader: 5 concurrent callers share 1 connection', async () => {
  let loads = 0;
  const fakeLoad = async () => { await new Promise((r) => setTimeout(r, 10)); loads++; return { id: loads }; };
  let promise = null;
  function newGetLocal() {
    if (!promise) { promise = fakeLoad(); }
    return promise;
  }
  const conns = await Promise.all([newGetLocal(), newGetLocal(), newGetLocal(), newGetLocal(), newGetLocal()]);
  assert(loads === 1, 'the promise-cached loader must load once, got ' + loads);
  assert(conns.every((c) => c === conns[0]), 'every caller must get the same connection');
});

// ── 3. GREEN: busy_timeout waits for another process's lock ──────────────
// The holder: another process, because node:sqlite is synchronous — an
// in-process holder could never commit while the writer waits.
const holderCode = `
  import { DatabaseSync } from 'node:sqlite';
  import { writeFileSync } from 'node:fs';
  const c = new DatabaseSync(process.env.SIM_DB);
  c.exec('BEGIN IMMEDIATE');
  c.prepare("INSERT INTO orders (id, total) VALUES (" + Number(process.env.SIM_ORDER_ID) + ", 1)").run();
  writeFileSync(process.env.SIM_MARKER, 'held');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.SIM_HOLD_MS));
  c.exec('COMMIT');
  c.close();
`;
function holdLock(fn, orderId) {
  return new Promise((resolve, reject) => {
    try { unlinkSync(marker); } catch { /* not there */ }
    const child = spawn(process.execPath, ['--input-type=module', '-e', holderCode], {
      env: { ...process.env, SIM_DB: dbFile, SIM_MARKER: marker, SIM_HOLD_MS: '2000', SIM_ORDER_ID: String(orderId) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    const timeout = setTimeout(() => reject(new Error('lock holder timed out; stderr: ' + stderr)), 15000);
    // Wait until the child actually holds the lock, then run the attempt.
    const poll = setInterval(() => {
      if (!existsSync(marker)) return;
      clearInterval(poll);
      let attemptErr = null;
      try { fn(); } catch (e) { attemptErr = e; }
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) return reject(new Error('lock holder exited ' + code + '; stderr: ' + stderr));
        if (attemptErr) return reject(attemptErr);
        resolve();
      });
    }, 25);
  });
}

await checkAsync('writer with busy_timeout 0 fails fast while the lock is held', async () => {
  await holdLock(() => {
    const w = new DatabaseSync(dbFile);
    try {
      let err = null;
      const t0 = Date.now();
      try { w.prepare('DELETE FROM sync_outbox').run(); } catch (e) { err = e; }
      const ms = Date.now() - t0;
      assert(err && /database is locked/.test(err.message), 'expected "database is locked", got ' + (err ? err.message : 'no error'));
      assert(ms < 1000, 'busy_timeout 0 must fail fast, took ' + ms + 'ms');
    } finally { w.close(); }
  }, 9001);
});

await checkAsync('writer with busy_timeout 5000 waits and the write lands', async () => {
  await holdLock(() => {
    const w = new DatabaseSync(dbFile);
    try {
      w.exec('PRAGMA busy_timeout = 5000');
      const t0 = Date.now();
      w.prepare('DELETE FROM sync_outbox').run();
      const ms = Date.now() - t0;
      assert(ms >= 1000, 'the writer must have waited for the lock, took ' + ms + 'ms');
      assert(ms < 10000, 'the writer must not hang, took ' + ms + 'ms');
    } finally { w.close(); }
  }, 9002);
  const verify = new DatabaseSync(dbFile);
  try {
    assert(verify.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c === 0, 'the sync write must have landed');
    assert(verify.prepare('SELECT COUNT(*) AS c FROM orders WHERE id IN (9001, 9002)').get().c === 2, 'both holders’ rows must have committed');
  } finally { verify.close(); }
});

// ── 4. source tie-in ─────────────────────────────────────────────────────
check('source tie-in: db.ts promise-caches the load and sets busy_timeout', () => {
  const src = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
  assert(src.includes('LOCAL_BUSY_TIMEOUT_MS = 5000'), 'db.ts must export the 5000ms timeout');
  assert(src.includes('PRAGMA busy_timeout'), 'db.ts must run the pragma on the connection');
  assert(src.includes('localConnPromise'), 'db.ts must cache the load promise');
  assert(!src.includes('if (!localConn)'), 'the old assign-after-await loader must be gone');
});

for (const f of [dbFile, marker]) { try { unlinkSync(f); } catch { /* already gone */ } }

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
