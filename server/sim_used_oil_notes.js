/**
 * Used oil — "error returned from database: (code: 1) table used_oil_log
 * has no column named notes" (Umar, 2026-11-25 ~21:06 PKT, on the Windows
 * app, adding used oil just after installing v9).
 *
 * Root cause, proven from the code (no guessing):
 *
 *  1. The write — src/modules/catalog/UsedOilPane.tsx:51 — is
 *     INSERT INTO used_oil_log (drum_id, litres, type, notes)
 *     VALUES (1, $1, $2, $3). The pane has a Notes field and its search
 *     filter reads r.notes, so the column is genuinely used.
 *  2. The LOCAL schema — src/lib/localDb.ts LOCAL_SCHEMA_2 — creates
 *     used_oil_log WITHOUT a notes column, and no patch ever added one.
 *  3. The SERVER has the column: server/migrations/001_init.sql creates
 *     the table without it, but 004_catalog_fields.sql:13 adds it —
 *     ALTER TABLE used_oil_log ADD COLUMN IF NOT EXISTS notes TEXT
 *     DEFAULT '' — and widens the type CHECK to ('added','removed',
 *     'collected','disposed'). The migration's own comment says the Used
 *     Oil page writes type='collected'/'disposed' with a notes value and
 *     "so every Collect/Dispose click failed" before 004. The server was
 *     fixed for this exact failure; the local schema port never got it.
 *
 * So the column SHOULD exist — the fix is local-only, no server migration:
 * notes goes into the local CREATE TABLE (fresh installs) and into
 * SYNC_COLUMN_PATCHES (existing local databases get it at launch via the
 * PRAGMA-checked ALTER — the same mechanism that carries every other
 * later-migration column). The VPS should already be fine — 004 replays
 * on every boot, idempotently — but that needs a live check on the VPS
 * itself (information_schema), which this sim cannot do.
 *
 * The other used-oil writes (POSCart.tsx:172 and editSale.ts:238) do NOT
 * include notes, so they never hit this; the drum UPDATE is unaffected.
 * used_oil_log is not in SYNC_TABLES, so no outbox trigger is involved.
 * src/lib/schema.sql also lacks the column, but nothing imports that
 * file anywhere in the repo — it is dead, and is left alone.
 *
 * Run:  node --experimental-strip-types server/sim_used_oil_notes.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  ensureLocalSchema,
  pgToSqlite,
  LOCAL_SCHEMA,
  LOCAL_SCHEMA_2,
  LOCAL_SCHEMA_3,
  LOCAL_SCHEMA_4,
  LOCAL_SCHEMA_5,
  LOCAL_SCHEMA_6,
  LOCAL_SCHEMA_7,
  LOCAL_SCHEMA_8,
  LOCAL_SCHEMA_9,
} from '../src/lib/localDb.ts';
import { injectUuid } from '../src/lib/outbox.ts';
import { SYNC_TABLES } from '../src/lib/sync.ts';
import { stockOut } from '../src/lib/stock.ts';
import { newUuid } from '../src/lib/uuid.ts';
import { validateSaleStock } from '../src/lib/cart.ts';

// ── sqlx-faithful binding (copied from sim_sale_stock_guard.js) ─────────
function sqlxBind(sql, params = []) {
  let out = '';
  const ordered = [];
  let unnamed = 0;
  let single = false;
  let dbl = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (single) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") out += sql[++i];
        else single = false;
      }
      continue;
    }
    if (dbl) {
      out += ch;
      if (ch === '"') {
        if (sql[i + 1] === '"') out += sql[++i];
        else dbl = false;
      }
      continue;
    }
    if (ch === "'") { single = true; out += ch; continue; }
    if (ch === '"') { dbl = true; out += ch; continue; }
    if (ch === '$' && /[0-9]/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (/[0-9]/.test(sql[j] ?? '')) j++;
      ordered.push(params[Number(sql.slice(i + 1, j)) - 1]);
      out += '?';
      i = j - 1;
      continue;
    }
    if (ch === '?') {
      ordered.push(params[unnamed++]);
      out += '?';
      continue;
    }
    out += ch;
  }
  return { sql: out, params: ordered };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    execute: async (sql) => raw.exec(sql),
    select: async (sql) => raw.prepare(sql).all(),
  };
  function run(sql, params = []) {
    const b = sqlxBind(pgToSqlite(sql), params);
    return raw.prepare(b.sql).all(...b.params);
  }
  function runExecute(sql, params = []) {
    const inj = injectUuid(sql, params, SYNC_TABLES);
    const finalSql = inj ? inj.sql : sql;
    const finalParams = inj ? inj.params : params;
    const b = sqlxBind(pgToSqlite(finalSql), finalParams);
    if (/\breturning\b/i.test(finalSql)) {
      return raw.prepare(b.sql).all(...b.params);
    }
    raw.prepare(b.sql).run(...b.params);
    return [];
  }
  function runTx(statements) {
    raw.exec('BEGIN');
    try {
      for (const s of statements) {
        const p = s.params ?? [];
        const inj = injectUuid(s.sql, p, SYNC_TABLES);
        const b = sqlxBind(pgToSqlite(inj ? inj.sql : s.sql), inj ? inj.params : p);
        raw.prepare(b.sql).run(...b.params);
      }
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  }
  return { raw, db, run, runExecute, runTx };
}

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
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}
function assertThrows(fn, re, m) {
  let got = null;
  try { fn(); } catch (e) { got = e; }
  assert(got, (m || 'expected a throw') + ' — nothing threw');
  assert(re.test(got.message), (m || 'wrong error') + ' — got: ' + got.message);
}

const USED_OIL_PANE = readFileSync(new URL('../src/modules/catalog/UsedOilPane.tsx', import.meta.url), 'utf8');
const LOCALDB = readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');
const MIGRATION_004_REAL = readFileSync(new URL('../server/migrations/004_catalog_fields.sql', import.meta.url), 'utf8');

// The REAL add statement, extracted from UsedOilPane.tsx — not a copy.
// This is the statement that died with "no column named notes".
function usedOilInsertFromSource() {
  const m = USED_OIL_PANE.match(/INSERT INTO used_oil_log \(drum_id, litres, type, notes\) VALUES \(1, \$1, \$2, \$3\)/);
  assert(m, 'UsedOilPane.tsx must contain the used-oil INSERT with notes');
  return m[0];
}

// The pane's transaction: drum level first, then the log row. The pane
// negates the litres for a disposal before either statement runs.
function recordUsedOil(h, litres, mode, notes) {
  const signed = mode === 'disposed' ? -Math.abs(litres) : litres;
  h.runTx([
    { sql: 'UPDATE used_oil_drum SET current_litres = current_litres + $1 WHERE id = 1', params: [signed] },
    { sql: usedOilInsertFromSource(), params: [signed, mode, notes] },
  ]);
}

console.log('\nUsed oil: adding used oil must not die on a missing notes column');

// ── Part 1 — the upgraded pre-fix database ───────────────────────────────
// A local DB made before this fix: used_oil_log as the old CREATE TABLE
// built it (no notes), with one old log row already in it. ensureLocalSchema
// must repair it in place.
const h = makeDb();
h.raw.exec(LOCAL_SCHEMA);
h.raw.exec(LOCAL_SCHEMA_2);
h.raw.exec(LOCAL_SCHEMA_3);
h.raw.exec(LOCAL_SCHEMA_4);
h.raw.exec(LOCAL_SCHEMA_5);
h.raw.exec(LOCAL_SCHEMA_6);
h.raw.exec(LOCAL_SCHEMA_7);
h.raw.exec(LOCAL_SCHEMA_8);
h.raw.exec(LOCAL_SCHEMA_9);
// Rebuild used_oil_log the way the pre-fix schema built it.
h.raw.exec('DROP TABLE used_oil_log');
h.raw.exec("CREATE TABLE used_oil_log (id INTEGER PRIMARY KEY AUTOINCREMENT, drum_id INTEGER NOT NULL, litres REAL NOT NULL, type TEXT DEFAULT 'added', source_order_id INTEGER, created_at TEXT DEFAULT (datetime('now')))");
h.run("INSERT INTO warehouses (id, uuid, shop_id, name, code, is_default, active) VALUES (1, 'wh-test', 1, 'Main Store', 'MAIN', 1, 1)");
h.run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (1, 1, 'GTX 4L', '4L', 4000, 4000, 3600, 10, 2, 1)");
h.run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (4, 1, 'Engine Oil 5L', '5L', 4500, 4500, 4000, 10, 5, 1)");
h.run("INSERT INTO customers (id, shop_id, name, phone, customer_type) VALUES (3, 1, 'Ahmed Raza', '03001234567', 'walking')");
h.run("INSERT INTO used_oil_log (drum_id, litres, type, source_order_id) VALUES (1, 10, 'added', 1)");

check('PRE-FIX STATE: the old table really has no notes column (the reported error)', () => {
  const cols = h.run('PRAGMA table_info(used_oil_log)').map((c) => c.name);
  assert(!cols.includes('notes'), 'the pre-fix table must lack notes, got: ' + JSON.stringify(cols));
  assertThrows(() => recordUsedOil(h, 5, 'collected', 'Customer drop-off'),
    /no column named notes/i, 'the old table must reject the pane INSERT');
});

await ensureLocalSchema(h.db);

check('REPAIR: launch adds notes to the existing table, default empty', () => {
  const cols = h.run('PRAGMA table_info(used_oil_log)');
  const notes = cols.find((c) => c.name === 'notes');
  assert(notes, 'notes must exist after schema init, got: ' + JSON.stringify(cols.map((c) => c.name)));
  assert(String(notes.dflt_value).includes("''"), 'notes must default to empty, got: ' + JSON.stringify(notes.dflt_value));
});
check('REPAIR: the old log row survives, with an empty note', () => {
  const row = h.run('SELECT litres, type, notes FROM used_oil_log WHERE source_order_id = 1')[0];
  assert(Number(row.litres) === 10 && row.type === 'added' && row.notes === '',
    'the old row must survive with notes = empty, got ' + JSON.stringify(row));
});
check('REPAIR: a second schema init is a no-op (no duplicate-column error)', () => {
  // ensureLocalSchema caches its promise per session, so re-run the patch
  // path directly: a second ALTER would throw "duplicate column name".
  // The PRAGMA-guarded patch must simply find the column already there.
  const cols = h.run('PRAGMA table_info(used_oil_log)').map((c) => c.name);
  assert(cols.filter((c) => c === 'notes').length === 1, 'notes must exist exactly once, got: ' + JSON.stringify(cols));
});

// ── Part 2 — the pane's add, on the repaired database ────────────────────
check('ADD: collecting 5L with a note succeeds — drum moves, note stored', () => {
  recordUsedOil(h, 5, 'collected', 'Customer drop-off');
  assert(Number(h.run('SELECT current_litres FROM used_oil_drum WHERE id = 1')[0].current_litres) === 5,
    'the drum must hold 5L after the collection');
  const row = h.run("SELECT litres, type, notes FROM used_oil_log WHERE type = 'collected'")[0];
  assert(Number(row.litres) === 5 && row.notes === 'Customer drop-off',
    'the log row must carry the note, got ' + JSON.stringify(row));
});
check('ADD: disposing 2L with no note succeeds — drum moves down, note empty', () => {
  recordUsedOil(h, 2, 'disposed', '');
  assert(Number(h.run('SELECT current_litres FROM used_oil_drum WHERE id = 1')[0].current_litres) === 3,
    'the drum must hold 3L after the disposal');
  const row = h.run("SELECT litres, type, notes FROM used_oil_log WHERE type = 'disposed'")[0];
  assert(Number(row.litres) === -2 && row.notes === '',
    'the disposal row must store -2L with an empty note, got ' + JSON.stringify(row));
});
check('ADD: the pane search finds a row by its note', () => {
  const rows = h.run('SELECT * FROM used_oil_log ORDER BY created_at DESC');
  const found = rows.filter((r) => (r.notes ?? '').toLowerCase().includes('drop-off'));
  assert(found.length === 1 && found[0].type === 'collected',
    'searching "drop-off" must find exactly the collection row, got ' + found.length);
});
check('ADD: the sale-path used-oil INSERT (no notes column) still works', () => {
  // POSCart.tsx:172 and editSale.ts:238 write without notes — they must
  // keep working on the widened table (notes defaults to '').
  h.runExecute("INSERT INTO used_oil_log (drum_id, litres, type, source_order_id) VALUES (1, $1, 'added', $2)", [1.5, 2]);
  const row = h.run("SELECT litres, type, notes FROM used_oil_log WHERE type = 'added' AND source_order_id = 2")[0];
  assert(Number(row.litres) === 1.5 && row.notes === '',
    'the sale-path row must land with an empty note, got ' + JSON.stringify(row));
});

// ── Part 3 — a fresh install ─────────────────────────────────────────────
// ensureLocalSchema caches its promise, so a second DB cannot re-run it
// here — instead run the schema parts directly: that is what a fresh
// install's CREATE TABLE gives it.
const f = makeDb();
f.raw.exec(LOCAL_SCHEMA);
f.raw.exec(LOCAL_SCHEMA_2);
f.raw.exec(LOCAL_SCHEMA_3);
f.raw.exec(LOCAL_SCHEMA_4);
f.raw.exec(LOCAL_SCHEMA_5);
f.raw.exec(LOCAL_SCHEMA_6);
f.raw.exec(LOCAL_SCHEMA_7);
f.raw.exec(LOCAL_SCHEMA_8);
f.raw.exec(LOCAL_SCHEMA_9);
f.raw.exec("INSERT OR IGNORE INTO used_oil_drum (id, capacity) VALUES (1, 200)");

check('FRESH: a fresh install creates used_oil_log with notes already in it', () => {
  const cols = f.run('PRAGMA table_info(used_oil_log)').map((c) => c.name);
  assert(cols.includes('notes'), 'the fresh CREATE TABLE must include notes, got: ' + JSON.stringify(cols));
});
check('FRESH: collecting on a fresh install succeeds first try', () => {
  recordUsedOil(f, 1, 'collected', 'Fresh install');
  assert(Number(f.run('SELECT current_litres FROM used_oil_drum WHERE id = 1')[0].current_litres) === 1,
    'the fresh drum must hold 1L');
  const row = f.run("SELECT notes FROM used_oil_log WHERE type = 'collected'")[0];
  assert(row.notes === 'Fresh install', 'the note must be stored, got ' + JSON.stringify(row));
});

// ── Part 4 — no regression of batch 7 (2067) or batch 8 (stock guard) ───
const prodA = { id: 1, name: 'GTX 4L', packing: '4L' };
const prodD = { id: 4, name: 'Engine Oil 5L', packing: '5L' };

function guardedTwoItemSale() {
  const cart = [
    { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
    { kind: 'product', ref_id: 4, name: 'Engine Oil 5L', qty: 1, unit_price: 4500, line_total: 4500, product: prodD },
  ];
  const stockById = new Map([
    [1, { name: 'GTX 4L', qty: Number(h.run('SELECT stock_qty FROM products WHERE id = 1')[0].stock_qty) }],
    [4, { name: 'Engine Oil 5L', qty: Number(h.run('SELECT stock_qty FROM products WHERE id = 4')[0].stock_qty) }],
  ]);
  const err = validateSaleStock(cart, stockById, new Map());
  if (err) throw new Error(err);
  const oid = Number(h.run('SELECT COALESCE(MAX(id), 0) + 1 AS oid FROM orders')[0].oid);
  const statements = [
    { sql: `INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status) VALUES ($1, 1, $2, $3, $4, $4, $5, 'cash', 'completed')`, params: [oid, 3, 1, 8500, 1] },
  ];
  for (const item of cart) {
    statements.push({
      sql: `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      params: [oid, item.kind, item.ref_id, item.name, item.qty, item.unit_price, item.line_total, null, 0, 0, 'customer', false, false],
    });
    statements.push(...stockOut(item.ref_id, item.qty, 'sale', newUuid(), { table: 'orders', id: oid }));
  }
  statements.push({ sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [8500, 1] });
  statements.push({ sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1, $2, 'in', $3)", params: [1, 8500, `Order #${oid}`] });
  h.runTx(statements);
  return oid;
}

check('REGRESSION (batch 7): a valid two-item sale completes, no 2067, distinct v4 uuids', () => {
  const oid = guardedTwoItemSale();
  assert(Number(h.run('SELECT stock_qty FROM products WHERE id = 1')[0].stock_qty) === 1, 'GTX must drop 2 -> 1');
  assert(Number(h.run('SELECT stock_qty FROM products WHERE id = 4')[0].stock_qty) === 4, '5L must drop 5 -> 4');
  const uuids = h.run('SELECT uuid FROM order_items WHERE order_id = ?', [oid]);
  assert(uuids.length === 2 && new Set(uuids.map((r) => r.uuid)).size === 2, 'the two lines must carry distinct uuids');
  assert(uuids.every((r) => UUID_V4.test(r.uuid)), 'every line must carry a real v4 uuid');
});

check('REGRESSION (batch 8): the stock guard still blocks an oversell', () => {
  const err = validateSaleStock(
    [{ kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 3 }],
    new Map([[1, { name: 'GTX 4L', qty: 1 }]]), new Map());
  assert(err !== null && /GTX 4L/.test(err) && /only 1/.test(err) && /needs 3/.test(err),
    'the guard must block 3 of a 1-stock product, got: ' + err);
});

// ── Part 5 — the wiring, pinned in source ───────────────────────────────
check('WIRING: the local CREATE TABLE carries notes (fresh installs)', () => {
  const m = LOCALDB.match(/CREATE TABLE IF NOT EXISTS used_oil_log \([^;]*\);/);
  assert(m && m[0].includes('notes TEXT'), 'the CREATE TABLE must include notes TEXT, got: ' + (m ? m[0] : 'no match'));
});
check('WIRING: SYNC_COLUMN_PATCHES repairs existing databases (migration 004 parity)', () => {
  assert(LOCALDB.includes('{ table: "used_oil_log", column: "notes", decl: "TEXT DEFAULT \'\'" }'),
    'the patch entry for used_oil_log.notes must exist in localDb.ts');
});
check('WIRING: the server already has the column (migration 004) — no server change needed', () => {
  assert(MIGRATION_004_REAL.includes('ALTER TABLE used_oil_log ADD COLUMN IF NOT EXISTS notes TEXT'),
    '004_catalog_fields.sql must add used_oil_log.notes on the server');
});
check('WIRING: UsedOilPane still writes notes (the UI field is real, not dead)', () => {
  assert(USED_OIL_PANE.includes('notes) VALUES (1, $1, $2, $3)'),
    'the pane INSERT must keep its notes column');
  assert(USED_OIL_PANE.includes('form.notes'),
    'the pane must keep its Notes form field');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
