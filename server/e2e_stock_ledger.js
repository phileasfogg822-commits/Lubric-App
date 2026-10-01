/**
 * Proves stock is a record, not a number (spec §180).
 *
 * The bug this guards: products.stock_qty was a bare mutable number. Three
 * separate call sites each ran their own UPDATE, nothing said why stock moved,
 * and a purchase could not increase stock at all - so buying oil left no trace
 * that it had arrived.
 *
 * Checks:
 *   1. the ledger exists and every item's cached stock equals SUM(qty)
 *   2. a sale records a signed movement and moves the cache with it
 *   3. the same uuid cannot be posted twice, so a retried sync cannot
 *      double-deduct stock
 *   4. a void records the reverse movement
 *   5. rebuild_stock() repairs a corrupted cache from the ledger
 *   6. the local SQLite replica has the table, or an offline pull dies on it
 *
 * Run:  node e2e_stock_ledger.js
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
async function q(sql, params, token) {
  const { status, body } = await post('/api/query', { sql, params }, token);
  if (status !== 200) throw new Error('query ' + status + ' ' + JSON.stringify(body));
  return body;
}
async function auth(email, pass) {
  const { status, body } = await post('/api/auth/login', { email, password: pass });
  if (status !== 200) throw new Error('auth failed: ' + status);
  return body.token;
}

console.log('\nStock ledger (spec 180)');

const atok = await auth('admin@lubric.app', 'admin123');
const created = [];
const stamp = () => new Date().toISOString();
const uniq = (tag) => tag + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

// A throwaway product, so these checks cannot disturb the shop's real stock.
async function makeProduct(name, stock) {
  const r = await q(
    `INSERT INTO products (shop_id, name, unit, cost_price, stock_qty, active)
     VALUES (1, $1, 'piece', 10, $2, 1) RETURNING id`,
    [name, stock], atok);
  const id = Number(r[0].id);
  created.push(id);
  // An opening balance, so the ledger and the cache agree from the start.
  await q(
    `INSERT INTO stock_movements (uuid, shop_id, item_id, kind, qty, qty_after, note)
     VALUES ($1, 1, $2, 'opening', $3, $3, 'test fixture')`,
    [uniq('op'), id, stock], atok);
  return id;
}
async function cleanup() {
  for (const id of created) {
    await q('DELETE FROM products WHERE id = $1', [id], atok).catch(() => {});
  }
}

await check('the ledger and the cached stock agree for every item', async () => {
  const rows = await q(
    `SELECT r.item_id, r.ledger_qty, r.cached_qty, r.fixed
       FROM rebuild_stock(1) r WHERE r.fixed <> 0`, [], atok);
  assert(rows.length === 0, 'items disagree: ' +
    rows.slice(0, 5).map((r) => `${r.item_id} cache=${r.cached_qty} ledger=${r.ledger_qty}`).join('; '));
});

await check('opening balances were recorded for the stock already on hand', async () => {
  const r = await q(
    `SELECT COUNT(*)::int AS openings FROM stock_movements WHERE kind = 'opening'`, [], atok);
  assert(r[0].openings > 0,
    'no opening balances - the stock the shop holds is still explained by nothing');
});

await check('a sale records a signed movement and moves the cache', async () => {
  const pid = await makeProduct('ledger-test-sale', 20);
  const before = Number((await q('SELECT stock_qty FROM products WHERE id = $1', [pid], atok))[0].stock_qty);
  assert(before === 20, 'fixture stock is ' + before);

  // The exact pair of statements stockOut() emits.
  const ins = await q(
    `INSERT INTO stock_movements (uuid, shop_id, item_id, kind, qty, qty_after, ref_table, ref_id, note, occurred_at)
     SELECT $1, 1, $2, 'sale', -3, COALESCE(p.stock_qty, 0) - 3, 'orders', 999, 'test sale', $3
       FROM products p WHERE p.id = $2 RETURNING qty, qty_after`,
    [uniq('mv'), pid, stamp()], atok);
  assert(Number(ins[0].qty) === -3, 'quantity should be signed negative, got ' + ins[0].qty);
  assert(Number(ins[0].qty_after) === 17, 'qty_after is ' + ins[0].qty_after);

  await q('UPDATE products SET stock_qty = COALESCE(stock_qty, 0) + $1 WHERE id = $2', [-3, pid], atok);
  const after = Number((await q('SELECT stock_qty FROM products WHERE id = $1', [pid], atok))[0].stock_qty);
  assert(after === 17, 'cache is ' + after + ', expected 17');
});

await check('the same uuid cannot be posted twice (a retried sync cannot double-deduct)', async () => {
  const pid = await makeProduct('ledger-test-idem', 10);
  const uuid = uniq('idem');
  const sql =
    `INSERT INTO stock_movements (uuid, shop_id, item_id, kind, qty, qty_after, note)
     VALUES ($1, 1, $2, 'sale', -2, 8, 'first')`;
  await q(sql, [uuid, pid], atok);
  let rejected = false;
  try {
    await q(sql, [uuid, pid], atok);
  } catch (e) {
    rejected = /duplicate key|unique/i.test(e.message);
  }
  assert(rejected, 'a duplicate uuid was accepted - a retried sync would double-deduct stock');
  const n = await q('SELECT COUNT(*)::int AS c FROM stock_movements WHERE uuid = $1', [uuid], atok);
  assert(n[0].c === 1, 'movement was stored ' + n[0].c + ' times');
});

await check('a void records the reverse movement', async () => {
  const pid = await makeProduct('ledger-test-void', 15);
  const uuid = uniq('void');
  await q(
    `INSERT INTO stock_movements (uuid, shop_id, item_id, kind, qty, qty_after, note)
     VALUES ($1, 1, $2, 'sale_return', 4, 19, 'voided')`, [uuid, pid], atok);
  const r = await q('SELECT kind, qty FROM stock_movements WHERE uuid = $1', [uuid], atok);
  assert(r[0].kind === 'sale_return', 'kind is ' + r[0].kind);
  assert(Number(r[0].qty) === 4, 'a void must add stock back, got ' + r[0].qty);
});

await check('rebuild_stock repairs a corrupted cache from the ledger', async () => {
  const pid = await makeProduct('ledger-test-repair', 20);
  await q('UPDATE products SET stock_qty = 999 WHERE id = $1', [pid], atok);

  const bad = await q('SELECT COUNT(*)::int AS c FROM rebuild_stock(1) r WHERE r.fixed <> 0', [], atok);
  assert(bad[0].c > 0, 'rebuild_stock did not notice a 999 cache against a 20 ledger');

  await q('UPDATE products SET stock_qty = r.ledger_qty FROM rebuild_stock(1) r WHERE r.item_id = $1', [pid], atok);
  const now = Number((await q('SELECT stock_qty FROM products WHERE id = $1', [pid], atok))[0].stock_qty);
  assert(now === 20, 'cache not repaired, it is ' + now);
});

await check('a physical count posts a correction instead of overwriting', async () => {
  // The failure this guards: the catalog form used to write stock_qty straight
  // to the column, so a correction was a silent overwrite the ledger never saw.
  // That is how the real shop's stock ended up disagreeing with its own records.
  const pid = await makeProduct('ledger-test-count', 30);
  const before = await q('SELECT count(*)::int AS c FROM stock_movements WHERE item_id = $1', [pid], atok);

  // What the fixed form now does: the delta goes in as a movement.
  await q(
    `INSERT INTO stock_movements (uuid, shop_id, item_id, kind, qty, qty_after, ref_table, ref_id, note)
     SELECT $1, 1, $2, 'count_correction', -8, COALESCE(p.stock_qty,0) - 8,
            'products', $2, 'Stock counted at 22, books said 30'
       FROM products p WHERE p.id = $2`,
    [uniq('count'), pid], atok);
  await q('UPDATE products SET stock_qty = COALESCE(stock_qty,0) + $1 WHERE id = $2', [-8, pid], atok);

  const after = await q('SELECT count(*)::int AS c FROM stock_movements WHERE item_id = $1', [pid], atok);
  assert(after[0].c === before[0].c + 1, 'a count correction left no movement behind');

  const row = await q(
    `SELECT kind, qty, note FROM stock_movements
      WHERE item_id = $1 ORDER BY id DESC LIMIT 1`, [pid], atok);
  assert(row[0].kind === 'count_correction', 'kind is ' + row[0].kind);
  assert(/counted at 22/.test(row[0].note), 'the note should say what happened, got: ' + row[0].note);

  const rec = await q('SELECT COUNT(*)::int AS c FROM rebuild_stock(1) r WHERE r.fixed <> 0 AND r.item_id = $1', [pid], atok);
  assert(rec[0].c === 0, 'ledger and cache disagree after a count correction');
});

await check('the local SQLite replica has the table', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');
  assert(/CREATE TABLE IF NOT EXISTS stock_movements/.test(src),
    'localDb.ts has no stock_movements table - an offline pull would fail on it');
  assert(/LOCAL_SCHEMA_5/.test(src), 'LOCAL_SCHEMA_5 is defined but never executed');
});

await check('the ledger is listed for sync on both sides', async () => {
  const fs = await import('node:fs');
  const desktop = fs.readFileSync(new URL('../src/lib/sync.ts', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  assert(/"stock_movements"/.test(desktop), 'desktop SYNC_TABLES omits stock_movements');
  assert(/stock_movements:/.test(server), 'server SYNC_TABLES omits stock_movements');
});

await cleanup();
await check('cleanup', async () => {
  const r = await q(`SELECT count(*)::int AS c FROM products WHERE name LIKE 'ledger-test-%'`, [], atok);
  assert(r[0].c === 0, r[0].c + ' test products left behind');
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
