/**
 * Proves stock knows WHERE it is, without breaking what a total means
 * (migration 033).
 *
 * The design risk this checks: products.stock_qty (the total) and stock_levels
 * (per warehouse) are TWO CACHES over the same ledger, and two caches can
 * disagree. They are both derived, and the migration refuses to commit if they
 * contradict - but that promise has to be tested too, not just declared.
 *
 * The centrepiece is the transfer: moving stock between warehouses must leave
 * the product's TOTAL UNCHANGED, because the stock did not leave the shop - it
 * moved. A transfer that altered the total would be a stock loss recorded as a
 * relocation, and the shelf count would drift on every move.
 *
 * Run:  node e2e_warehouses.js
 *       API_BASE=http://localhost:3001
 */

// The REAL helpers, imported so this test exercises the code the POS uses
// rather than a copy of it. Requires --experimental-strip-types.
import { stockIn, stockTransfer } from '../src/lib/stock.ts';

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
async function exec(sql, params, token) {
  return post('/api/execute', { sql, params }, token);
}

console.log('\nWarehouses and locations');

const atok = (await post('/api/auth/login', { email: 'admin@lubric.app', password: 'admin123' })).body.token;
const created = { products: [], warehouses: [] };

async function insert(sql, params) {
  const r = await exec(sql, params, atok);
  assert(r.status === 200, 'fixture insert failed (' + r.status + '): ' + JSON.stringify(r.body));
  assert(r.body.rows && r.body.rows.length, 'fixture insert returned no rows: ' + JSON.stringify(r.body));
  return Number(r.body.rows[0].id);
}

/**
 * Run statements as ONE transaction - the /api/transaction endpoint, which is
 * exactly what dbTransaction calls in the browser. A transfer must be atomic:
 * committing only its outgoing half would destroy stock.
 */
async function tx(statements) {
  const statementsOut = statements.map((s) => ({ sql: s.sql, params: s.params }));
  const { status, body } = await post('/api/transaction', { statements: statementsOut }, atok);
  if (status !== 200) throw new Error('transaction failed (' + status + '): ' + JSON.stringify(body));
  return body;
}

/** The product's total across every warehouse. */
async function totalOf(pid) {
  const rows = await q('SELECT stock_qty FROM products WHERE id = $1', [pid], atok);
  return Number(rows[0].stock_qty);
}

await check('every outlet has exactly one default warehouse', async () => {
  const rows = await q(
    `SELECT s.name AS outlet, COUNT(w.id) FILTER (WHERE w.is_default AND w.active = 1) AS defaults
       FROM shops s LEFT JOIN warehouses w ON w.shop_id = s.id
      GROUP BY s.id, s.name ORDER BY s.id`, [], atok);
  assert(rows.length > 0, 'no outlets found');
  for (const r of rows) {
    assert(Number(r.defaults) === 1,
      `outlet "${r.outlet}" has ${r.defaults} default warehouse(s) - the POS has no bin to fall back to`);
  }
});

await check('no stock movement is left in no warehouse', async () => {
  // A movement with no warehouse is counted nowhere: it would silently vanish
  // from every per-warehouse total while still counting in stock_qty.
  const rows = await q(
    'SELECT id, item_id FROM stock_movements WHERE warehouse_id IS NULL', [], atok);
  assert(rows.length === 0, rows.length + ' movement(s) have no warehouse');
});

await check('the total and the per-warehouse sum agree for every item', async () => {
  // The two-caches risk, asserted rather than assumed. Both are derived from the
  // same ledger; if they ever disagree, one of the two numbers a shopkeeper sees
  // is wrong.
  const rows = await q(
    `SELECT p.id, p.name, p.stock_qty, COALESCE(l.qty, 0) AS per_warehouse
       FROM products p
       LEFT JOIN (SELECT product_id, SUM(qty) AS qty FROM stock_levels
                   WHERE shop_id = 1 GROUP BY product_id) l ON l.product_id = p.id
      WHERE p.shop_id = 1 AND COALESCE(p.stock_qty, 0) <> COALESCE(l.qty, 0)`, [], atok);
  assert(rows.length === 0, rows.length + ' item(s) disagree: ' +
    rows.slice(0, 3).map((r) => `${r.name} total=${r.stock_qty} per_warehouse=${r.per_warehouse}`).join('; '));
});

await check('rebuild_stock_levels reports zero drift', async () => {
  const rows = await q(
    'SELECT count(*)::int AS n FROM rebuild_stock_levels(1) WHERE fixed <> 0', [], atok);
  assert(rows[0].n === 0, rows[0].n + ' warehouse level(s) drift from the ledger');
});

await check('rebuild_stock still reports zero drift on the total', async () => {
  const rows = await q(
    'SELECT count(*)::int AS n FROM rebuild_stock(1) WHERE fixed <> 0', [], atok);
  assert(rows[0].n === 0, rows[0].n + ' total(s) drift from the ledger');
});

// ── the transfer: the stock moved, it did not leave ────────────────────────
await check('a transfer does not change the product total', async () => {
  const pid = await insert(
    // stock_qty 0, NOT 10: stockIn() below adds the 10, so seeding 10 here too
    // would leave the product at 20 while stock_levels held 10 - and the
    // "two caches agree" assertions would then fail for a reason that had
    // nothing to do with transfers.
    `INSERT INTO products (shop_id, name, unit, packing, stock_qty, active)
     VALUES (1, $1, 'drum', '20L', 0, 1) RETURNING id`,
    ['wh-test-' + Date.now()]);
  created.products.push(pid);

  const def = await q('SELECT id FROM warehouses WHERE shop_id = 1 AND is_default', [], atok);
  const mainWh = Number(def[0].id);
  const second = await insert(
    `INSERT INTO warehouses (uuid, shop_id, name, code, is_default, active)
     VALUES ($1, 1, 'Test Store', 'TST', FALSE, 1) RETURNING id`,
    ['wh-t-' + Date.now()]);
  created.warehouses.push(second);

  // Post the fixture through the REAL helper in ONE transaction - the same path
  // the POS uses. A transfer must not be possible to run halfway.
  await tx(stockIn(pid, 10, 'opening', 'whtest-' + pid, { warehouseId: mainWh }));
  const before = await totalOf(pid);

  await tx(stockTransfer(pid, 4, mainWh, second, { note: 'Test move' }));
  const after = await totalOf(pid);

  assert(after === before,
    `total changed by the transfer: ${before} -> ${after}. A transfer must net to zero`);

  const levels = await q(
    `SELECT w.name, l.qty FROM stock_levels l
       JOIN warehouses w ON w.id = l.warehouse_id
      WHERE l.product_id = $1`, [pid], atok);
  const inMain = Number((levels.find((r) => r.name !== 'Test Store') || {}).qty ?? 0);
  const inTest = Number((levels.find((r) => r.name === 'Test Store') || {}).qty ?? 0);
  assert(inMain === 6, `origin warehouse should hold 6, holds ${inMain}`);
  assert(inTest === 4, `destination warehouse should hold 4, holds ${inTest}`);
  assert(inMain + inTest === after, 'the two warehouse levels do not add up to the total');
});

await check('both halves of a transfer are recorded, and balance each other', async () => {
  const rows = await q(
    `SELECT kind, SUM(qty) AS net FROM stock_movements
      WHERE kind IN ('transfer_in','transfer_out') GROUP BY kind`, [], atok);
  assert(rows.length === 2, 'expected both transfer kinds, got ' + JSON.stringify(rows));
  const ins = Number(rows.find((r) => r.kind === 'transfer_in').net);
  const outs = Number(rows.find((r) => r.kind === 'transfer_out').net);
  assert(Math.abs(ins + outs) < 0.0001,
    `transfer halves do not net to zero: in ${ins}, out ${outs}`);
});

await check('the local SQLite replica has the warehouse tables and columns', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');
  for (const t of ['warehouses', 'warehouse_locations', 'stock_levels']) {
    assert(new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '\\b').test(src),
      'localDb.ts is missing ' + t);
  }
  // The two columns the sync now sends on stock_movements must be patched in,
  // or the whole offline pull dies on "no such column".
  assert(/table: "stock_movements", column: "warehouse_id"/.test(src),
    'stock_movements.warehouse_id is not patched into the local schema');
  assert(/table: "stock_movements", column: "location_id"/.test(src),
    'stock_movements.location_id is not patched into the local schema');
});

await check('cleanup', async () => {
  const failed = [];
  const del = async (sql, params, what) => {
    const r = await exec(sql, params, atok);
    if (r.status !== 200) failed.push(what + ': ' + JSON.stringify(r.body));
  };
  for (const id of created.products) {
    await del('DELETE FROM stock_levels WHERE product_id = $1', [id], 'levels ' + id);
    await del('DELETE FROM stock_movements WHERE item_id = $1', [id], 'movements ' + id);
    await del('DELETE FROM products WHERE id = $1', [id], 'product ' + id);
  }
  for (const id of created.warehouses) {
    await del('DELETE FROM warehouses WHERE id = $1', [id], 'warehouse ' + id);
  }
  assert(failed.length === 0, 'cleanup errors: ' + failed.join(' | '));
  const left = await q(`SELECT COUNT(*)::int AS n FROM products WHERE name LIKE 'wh-test-%'`, [], atok);
  assert(left[0].n === 0, left[0].n + ' test products left behind');
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);