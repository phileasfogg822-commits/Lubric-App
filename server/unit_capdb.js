/**
 * Unit tests for the Capacitor SQLite driver (src/lib/capDb.ts).
 *
 * The driver is the phone build's local database: it must translate the
 * app's Postgres-style SQL ($1 placeholders, multi-statement DDL) into what
 * @capacitor-community/sqlite accepts, without mangling string literals.
 * The plugin itself is not here, so the tests drive createCapDb() with a
 * fake connection that records every call.
 *
 * Run:  node --experimental-strip-types server/unit_capdb.js
 */

import { prepareStatements, createCapDb } from '../src/lib/capDb.ts';

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { console.log(`FAIL - ${title}: ${e.message}`); }
}
async function checkAsync(title, fn) {
  total++;
  try { await fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { console.log(`FAIL - ${title}: ${e.message}`); }
}
function eq(a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`expected ${sb}, got ${sa}`);
}

check('positional placeholders become ? in order', () => {
  eq(prepareStatements('SELECT * FROM customers WHERE id = $1 AND shop_id = $2'), ['SELECT * FROM customers WHERE id = ? AND shop_id = ?']);
});

check('two-digit placeholders collapse to one ?', () => {
  eq(prepareStatements('SELECT * FROM t WHERE a = $10'), ['SELECT * FROM t WHERE a = ?']);
});

check('dollar amounts inside string literals are untouched', () => {
  eq(prepareStatements("SELECT * FROM expenses WHERE note = 'paid $1 for tea' AND amount = $1"),
    ["SELECT * FROM expenses WHERE note = 'paid $1 for tea' AND amount = ?"]);
});

check('escaped quotes do not end the literal', () => {
  eq(prepareStatements("INSERT INTO t (note) VALUES ('it''s $1; ok')"),
    ["INSERT INTO t (note) VALUES ('it''s $1; ok')"]);
});

check('semicolons split statements but not inside literals', () => {
  eq(prepareStatements("CREATE TABLE IF NOT EXISTS a (id INTEGER); CREATE TABLE IF NOT EXISTS b (note TEXT DEFAULT 'a;b');"),
    ['CREATE TABLE IF NOT EXISTS a (id INTEGER)', "CREATE TABLE IF NOT EXISTS b (note TEXT DEFAULT 'a;b')"]);
});

check('empty statements are dropped', () => {
  eq(prepareStatements(';; SELECT 1; ;'), ['SELECT 1']);
});

await checkAsync('select unwraps values and translates params', async () => {
  const calls = [];
  const fake = {
    query: async (s, v) => { calls.push([s, v]); return { values: [{ n: 3 }] }; },
    run: async () => { throw new Error('run should not be called by select'); },
  };
  const db = createCapDb(fake);
  const rows = await db.select('SELECT COUNT(*) AS n FROM outbox WHERE id = $1', [7]);
  eq(rows, [{ n: 3 }]);
  eq(calls, [['SELECT COUNT(*) AS n FROM outbox WHERE id = ?', [7]]]);
});

await checkAsync('single-statement execute runs once with translated params', async () => {
  const calls = [];
  const fake = {
    query: async () => { throw new Error('query should not be called by execute'); },
    run: async (s, v) => { calls.push([s, v]); return { changes: { changes: 1 } }; },
  };
  const db = createCapDb(fake);
  const r = await db.execute('DELETE FROM sync_outbox WHERE id = $1', [9]);
  eq(r.rowsAffected, 1);
  eq(calls, [['DELETE FROM sync_outbox WHERE id = ?', [9]]]);
});

await checkAsync('multi-statement execute runs each statement with no params', async () => {
  const calls = [];
  const fake = {
    query: async () => { throw new Error('query should not be called by execute'); },
    run: async (s, v) => { calls.push([s, v]); return { changes: { changes: 0 } }; },
  };
  const db = createCapDb(fake);
  await db.execute('CREATE TABLE IF NOT EXISTS a (id INTEGER); CREATE TABLE IF NOT EXISTS b (id INTEGER);');
  eq(calls, [['CREATE TABLE IF NOT EXISTS a (id INTEGER)', []], ['CREATE TABLE IF NOT EXISTS b (id INTEGER)', []]]);
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
