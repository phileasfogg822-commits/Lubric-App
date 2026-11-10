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

import { prepareStatements, createCapDb, normalizeBindValue } from '../src/lib/capDb.ts';

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

check('a CREATE TRIGGER body keeps its inner semicolons', () => {
  const trigger = "CREATE TRIGGER IF NOT EXISTS trg_products_ins AFTER INSERT ON products WHEN NEW.uuid IS NOT NULL BEGIN INSERT INTO sync_outbox (table_name, row_uuid, op, payload) VALUES ('products', NEW.uuid, 'insert', json_object('uuid', NEW.uuid)); END;";
  // The trailing ; is the statement separator, so the returned statement
  // ends at END — but the inner ; survives, which is the whole point.
  eq(prepareStatements(trigger), [trigger.slice(0, -1)]);
});

check('a trigger followed by another statement still splits between them', () => {
  const trigger = "CREATE TRIGGER IF NOT EXISTS t AFTER INSERT ON t BEGIN INSERT INTO o (a) VALUES (1); END;";
  eq(prepareStatements(trigger + ' SELECT 1;'), [trigger.slice(0, -1), 'SELECT 1']);
});

check('booleans normalize to 0/1 for the plugin binder', () => {
  eq(normalizeBindValue(true), 1);
  eq(normalizeBindValue(false), 0);
});

check('objects and arrays normalize to their JSON text', () => {
  eq(normalizeBindValue({ chain: 'worn', tyres: 'low' }), '{"chain":"worn","tyres":"low"}');
  eq(normalizeBindValue(['pos', 'sales_history']), '["pos","sales_history"]');
});

check('strings, numbers and null pass through untouched', () => {
  eq(normalizeBindValue('Zafar'), 'Zafar');
  eq(normalizeBindValue(42), 42);
  eq(normalizeBindValue(1.5), 1.5);
  eq(normalizeBindValue(null), null);
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
    run: async (s, v, t) => { calls.push([s, v, t]); return { changes: { changes: 1 } }; },
  };
  const db = createCapDb(fake);
  const r = await db.execute('DELETE FROM sync_outbox WHERE id = $1', [9]);
  eq(r.rowsAffected, 1);
  eq(calls, [['DELETE FROM sync_outbox WHERE id = ?', [9], false]]);
});

await checkAsync('multi-statement execute runs each statement with no params', async () => {
  const calls = [];
  const fake = {
    query: async () => { throw new Error('query should not be called by execute'); },
    run: async (s, v, t) => { calls.push([s, v, t]); return { changes: { changes: 0 } }; },
  };
  const db = createCapDb(fake);
  await db.execute('CREATE TABLE IF NOT EXISTS a (id INTEGER); CREATE TABLE IF NOT EXISTS b (id INTEGER);');
  eq(calls, [['CREATE TABLE IF NOT EXISTS a (id INTEGER)', [], false], ['CREATE TABLE IF NOT EXISTS b (id INTEGER)', [], false]]);
});

await checkAsync('a pull-like upsert reaches the plugin with only bindable values', async () => {
  // Regression test for the 2026-11-10 tablet first-sync failure: the pull
  // carries order_items booleans and an inspections JSONB object, and the
  // Android binder throws on both. The driver must normalize before run.
  const calls = [];
  const fake = {
    query: async () => { throw new Error('query should not be called by execute'); },
    run: async (s, v, t) => { calls.push([s, v, t]); return { changes: { changes: 1 } }; },
  };
  const db = createCapDb(fake);
  await db.execute(
    'INSERT INTO order_items (uuid, leftover_released, billed_by_capacity) VALUES ($1, $2, $3) ON CONFLICT(uuid) DO UPDATE SET leftover_released = excluded.leftover_released WHERE (1)',
    ['abc-uuid', false, true]
  );
  await db.execute(
    'INSERT INTO inspections (uuid, inspection_data) VALUES ($1, $2) ON CONFLICT(uuid) DO UPDATE SET inspection_data = excluded.inspection_data WHERE (1)',
    ['insp-uuid', { chain: 'worn', tyres: 'low' }]
  );
  eq(calls, [
    ['INSERT INTO order_items (uuid, leftover_released, billed_by_capacity) VALUES (?, ?, ?) ON CONFLICT(uuid) DO UPDATE SET leftover_released = excluded.leftover_released WHERE (1)', ['abc-uuid', 0, 1], false],
    ['INSERT INTO inspections (uuid, inspection_data) VALUES (?, ?) ON CONFLICT(uuid) DO UPDATE SET inspection_data = excluded.inspection_data WHERE (1)', ['insp-uuid', '{"chain":"worn","tyres":"low"}'], false],
  ]);
});

await checkAsync('a sale transaction reaches the plugin bare: BEGIN, writes, COMMIT', async () => {
  // Regression test for the 2026-11-11 tablet failure: Complete Sale died
  // with "cannot start a transaction within a transaction" because the
  // plugin wraps every run() in its own transaction, so dbTransaction's
  // literal BEGIN collided with it. Every statement of the transaction
  // must go through with transaction=false, so BEGIN/COMMIT are real.
  const calls = [];
  const fake = {
    query: async () => { throw new Error('query should not be called by execute'); },
    run: async (s, v, t) => { calls.push([s, v, t]); return { changes: { changes: 1 } }; },
  };
  const db = createCapDb(fake);
  await db.execute('BEGIN');
  await db.execute('INSERT INTO orders (id, total, status) VALUES ($1, $2, $3)', [7, 1950, 'completed']);
  await db.execute('INSERT INTO order_items (order_id, product_name, qty) VALUES ($1, $2, $3)', [7, 'Havoline 20W-50', 1]);
  await db.execute('COMMIT');
  eq(calls, [
    ['BEGIN', [], false],
    ['INSERT INTO orders (id, total, status) VALUES (?, ?, ?)', [7, 1950, 'completed'], false],
    ['INSERT INTO order_items (order_id, product_name, qty) VALUES (?, ?, ?)', [7, 'Havoline 20W-50', 1], false],
    ['COMMIT', [], false],
  ]);
});

await checkAsync('select normalizes a boolean param the same way', async () => {
  const calls = [];
  const fake = {
    query: async (s, v) => { calls.push([s, v]); return { values: [] }; },
    run: async () => { throw new Error('run should not be called by select'); },
  };
  const db = createCapDb(fake);
  await db.select('SELECT * FROM order_items WHERE billed_by_capacity = $1', [true]);
  eq(calls, [['SELECT * FROM order_items WHERE billed_by_capacity = ?', [1]]]);
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
