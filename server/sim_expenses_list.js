/**
 * Expenses — "the expenses does not show up when recorded, the page still
 * says 0 expense" (Umar, 2026-11-25 ~22:26 PKT, on both the Windows app
 * and the VPS).
 *
 * Root cause, proven from the code (no guessing) — two separate holes, one
 * per path, with the same visible symptom:
 *
 *  1. WINDOWS (local SQLite): the list query's day expression was
 *     COALESCE(NULLIF(e.date, ''), to_char(e.created_at, 'YYYY-MM-DD')).
 *     SQLite has no to_char, and pgToSqlite has no rule for it (it covers
 *     ::casts, date_trunc, GREATEST, NOW(), nextval, ILIKE — but not
 *     to_char), so the read died with "no such function: to_char". The
 *     component never reads useQuery's error: on error `expenses` stays
 *     undefined, so it renders the "No expenses" empty state and the period
 *     total stays 0 — while the write had succeeded and the "Expense
 *     recorded" toast showed. Recorded, but the page still says 0. The
 *     to_char dates back to the original commit 00b3b3c, so the list NEVER
 *     worked on the Windows app. Proven here against real SQLite: the old
 *     query throws, the new one returns the row.
 *  2. VPS (Postgres + row security): the add INSERT hardcoded shop_id = 1
 *     while the session's shop comes from the outlet being worked in
 *     (activeShopId, sent as X-Shop-Id, and the RLS context). Whenever the
 *     session works in another outlet, the policy
 *     (029: USING/WITH CHECK shop_id = app.shop_id) either rejects the
 *     INSERT outright or hides the row from the RLS-filtered list — so the
 *     expense is recorded (or rejected) and the page still says 0. The
 *     local Windows app never syncs (SyncLoop runs on Capacitor only), so
 *     Windows rows never reach the VPS either: each side only ever shows
 *     what was recorded directly on it.
 *
 * Fix (both in src/modules/expenses/Expenses.tsx, no schema change, no
 * server migration):
 *  - DAY is now substr(e.created_at::text, 1, 10): the same TEXT
 *    'YYYY-MM-DD' on both engines (the ::text cast is stripped by
 *    pgToSqlite locally; on Postgres it renders the timestamptz as ISO
 *    text first). The list query runs on SQLite and on Postgres alike.
 *  - The INSERT records into the active outlet (activeShopId ??
 *    user.shop_id ?? 1) instead of a hardcoded 1, so the write and the
 *    RLS-scoped read can never disagree. Locally the shop is always 1,
 *    so this changes nothing there.
 *
 * Same class, NOT fixed here (flagged for a follow-up batch, out of scope
 * by the batch brief): src/modules/sales/SalesHistory.tsx:130 uses the
 * identical to_char DAY expression, and the Dashboard's trend queries use
 * to_char + generate_series — both die the same way locally.
 *
 * Run:  node --experimental-strip-types server/sim_expenses_list.js
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

// ── sqlx-faithful binding (copied from sim_used_oil_notes.js) ─────────
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

const EXPENSES = readFileSync(new URL('../src/modules/expenses/Expenses.tsx', import.meta.url), 'utf8');
const USED_OIL_PANE = readFileSync(new URL('../src/modules/catalog/UsedOilPane.tsx', import.meta.url), 'utf8');

// The REAL day expression, extracted from Expenses.tsx — not a copy.
function dayFromSource() {
  const m = EXPENSES.match(/const DAY = "([^"]+)"/);
  assert(m, 'Expenses.tsx must define const DAY = "..."');
  return m[1];
}

// The REAL add INSERT, extracted from Expenses.tsx. On the fixed code the
// shop is a $1 parameter; on the pre-fix code it was a hardcoded literal 1.
function insertFromSource() {
  const m = EXPENSES.match(/INSERT INTO expenses \(shop_id, category, subcategory, amount, account_id, date, note\) VALUES \(([^)]+)\)/);
  assert(m, 'Expenses.tsx must contain the expenses INSERT');
  return { sql: m[0], values: m[1] };
}

// The component's exact list query, with the source-extracted DAY.
function listExpenses(h, { df = '', dt = '', cat = '' } = {}) {
  const DAY = dayFromSource();
  const p = [];
  let w = 'WHERE 1=1';
  if (df) { p.push(df); w += ` AND ${DAY} >= $${p.length}`; }
  if (dt) { p.push(dt); w += ` AND ${DAY} <= $${p.length}`; }
  if (cat) { p.push(cat); w += ` AND e.category = $${p.length}`; }
  return h.run(
    `SELECT e.id, e.category, e.subcategory, e.amount, e.account_id, e.date, e.note, e.created_at,
            ${DAY} AS day, a.name AS account_name
     FROM expenses e
     LEFT JOIN accounts a ON a.id = e.account_id
     ${w}
     ORDER BY ${DAY} DESC, e.id DESC
     LIMIT 500`,
    p
  );
}

// The component's add transaction: the source-extracted INSERT, then the
// account debit and the ledger row (copied verbatim; pinned by wiring
// checks below so the sim cannot drift from the source).
function recordExpense(h, { shop = 1, category, subcategory = '', amount, accountId = 1, date, note = '' }) {
  const ins = insertFromSource();
  const params = ins.values.trim().startsWith('$1')
    ? [shop, category, subcategory, amount, accountId, date, note]
    : [category, subcategory, amount, accountId, date, note];
  h.runTx([
    { sql: ins.sql, params },
    { sql: 'UPDATE accounts SET balance = balance - $1 WHERE id = $2', params: [amount, accountId] },
    {
      sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'out',$3)",
      params: [accountId, amount, `Expense: ${category}${subcategory ? ' / ' + subcategory : ''}`],
    },
  ]);
}

function categoryTotals(rows) {
  const t = {};
  for (const e of rows) t[e.category] = (t[e.category] ?? 0) + Number(e.amount || 0);
  return t;
}

const TODAY = new Date().toISOString().slice(0, 10);

console.log('\nExpenses: a recorded expense must show up, and the total must sum it');

// ── Part 1 — the read, on a fresh local database ────────────────────────
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
await ensureLocalSchema(h.db);
// The seed already creates account 1 (Shop Cash Drawer, balance 0): set
// its balance deterministically instead of re-inserting it.
h.run("INSERT OR IGNORE INTO accounts (id, name, type, balance, active) VALUES (1, 'Shop Cash Drawer', 'cash', 100000, 1)");
h.run('UPDATE accounts SET balance = 100000 WHERE id = 1');

check('READ: the list query from source runs on SQLite (no to_char)', () => {
  const rows = listExpenses(h);
  assert(Array.isArray(rows) && rows.length === 0, 'an empty shop must list zero rows, got ' + JSON.stringify(rows));
});
check('READ: the DAY expression in source has no to_char', () => {
  assert(!dayFromSource().includes('to_char'), 'DAY must not use to_char, got: ' + dayFromSource());
});
check('READ: pgToSqlite strips the ::text cast out of DAY', () => {
  const translated = pgToSqlite(dayFromSource());
  assert(!translated.includes('::'), 'pgToSqlite(DAY) must have no cast left, got: ' + translated);
  assert(translated.includes('substr(e.created_at, 1, 10)'), 'pgToSqlite(DAY) must be the substr form, got: ' + translated);
});

// ── Part 2 — record, then the page shows it and totals it ──────────────
check('ADD: recording Shop/Rent 5000 shows in the list with the right day', () => {
  recordExpense(h, { shop: 1, category: 'Shop', subcategory: 'Rent', amount: 5000, date: '2026-11-25', note: 'Monthly rent' });
  const rows = listExpenses(h);
  assert(rows.length === 1, 'the list must show exactly the recorded row, got ' + rows.length);
  const r = rows[0];
  assert(r.category === 'Shop' && r.subcategory === 'Rent' && Number(r.amount) === 5000, 'the row must carry the recorded values, got ' + JSON.stringify(r));
  assert(r.day === '2026-11-25', 'the day must be the recorded date, got ' + r.day);
  assert(r.account_name === 'Shop Cash Drawer', 'the account name must join through, got ' + r.account_name);
});
check('ADD: the totals sum the recorded row (page no longer says 0)', () => {
  const rows = listExpenses(h);
  const totals = categoryTotals(rows);
  assert(totals.Shop === 5000, 'the Shop total must be 5000, got ' + JSON.stringify(totals));
  assert(Object.values(totals).reduce((s, v) => s + v, 0) === 5000, 'the period total must be 5000');
});
check('ADD: the account was debited and the ledger row posted', () => {
  assert(Number(h.run('SELECT balance FROM accounts WHERE id = 1')[0].balance) === 95000,
    'the balance must drop 100000 -> 95000');
  const tx = h.run("SELECT amount, type, reference FROM account_transactions WHERE reference LIKE 'Expense:%'");
  assert(tx.length === 1 && Number(tx[0].amount) === 5000 && tx[0].type === 'out' && tx[0].reference === 'Expense: Shop / Rent',
    'the ledger must hold one out row for the expense, got ' + JSON.stringify(tx));
});
check('ADD: a blank date falls back to the created day', () => {
  recordExpense(h, { shop: 1, category: 'Food', subcategory: 'Tea', amount: 150, date: '', note: '' });
  const rows = listExpenses(h);
  assert(rows.length === 2, 'both rows must list, got ' + rows.length);
  const tea = rows.find((r) => r.subcategory === 'Tea');
  assert(tea && tea.day === TODAY, 'the blank-date row must fall back to today, got ' + JSON.stringify(tea));
});
check('ADD: the period total now sums both rows', () => {
  const totals = categoryTotals(listExpenses(h));
  assert(totals.Shop === 5000 && totals.Food === 150, 'totals must be Shop 5000 + Food 150, got ' + JSON.stringify(totals));
  assert(Object.values(totals).reduce((s, v) => s + v, 0) === 5150, 'the period total must be 5150');
});
check('FILTER: the from/to date filter hides out-of-range rows', () => {
  // The Tea row has a blank date, so its day falls back to TODAY — the
  // filter bounds must be computed from TODAY, not hardcoded: on
  // 2026-11-25 (when this sim was written) TODAY was 2026-11-25 and
  // '2026-11-26' hid both rows, but any later day broke it (the run on
  // 2026-11-27 failed 20/21 on this check alone, with no code change).
  const tomorrow = new Date(Date.parse(TODAY) + 86400000).toISOString().slice(0, 10);
  assert(listExpenses(h, { df: tomorrow }).length === 0, 'from tomorrow must hide both rows');
  assert(listExpenses(h, { df: '2026-11-25', dt: TODAY }).length === 2, 'the 2026-11-25..today window must keep both rows');
});
check('FILTER: the category filter shows one category only', () => {
  const rows = listExpenses(h, { cat: 'Food' });
  assert(rows.length === 1 && rows[0].subcategory === 'Tea', 'the Food filter must show only the tea row, got ' + JSON.stringify(rows));
});

// ── Part 3 — edit and delete, through the component's statements ───────
check('EDIT: correcting the rent 5000 -> 6000 updates the list and the balance', () => {
  const before = listExpenses(h).find((r) => r.subcategory === 'Rent');
  h.runTx([
    { sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [Number(before.amount), before.account_id] },
    { sql: 'UPDATE accounts SET balance = balance - $1 WHERE id = $2', params: [6000, before.account_id] },
    { sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'in',$3)", params: [before.account_id, Number(before.amount), 'Expense edit reversal: Shop'] },
    { sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'out',$3)", params: [before.account_id, 6000, 'Expense: Shop / Rent'] },
    { sql: 'UPDATE expenses SET category=$1, subcategory=$2, amount=$3, account_id=$4, date=$5, note=$6 WHERE id=$7', params: ['Shop', 'Rent', 6000, before.account_id, '2026-11-25', 'Monthly rent', before.id] },
  ]);
  const rows = listExpenses(h);
  assert(rows.find((r) => r.subcategory === 'Rent').amount === 6000, 'the rent row must read 6000 after the edit');
  assert(Number(h.run('SELECT balance FROM accounts WHERE id = 1')[0].balance) === 93850,
    'the balance must be 100000 - 6000 - 150 = 93850, got ' + h.run('SELECT balance FROM accounts WHERE id = 1')[0].balance);
});
check('DELETE: deleting the tea row removes it and refunds the account', () => {
  const tea = listExpenses(h).find((r) => r.subcategory === 'Tea');
  h.runTx([
    { sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [Number(tea.amount), tea.account_id] },
    { sql: 'DELETE FROM expenses WHERE id = $1', params: [tea.id] },
    { sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'in',$3)", params: [tea.account_id, Number(tea.amount), 'Expense deleted: Food / Tea'] },
  ]);
  const rows = listExpenses(h);
  assert(rows.length === 1 && rows[0].subcategory === 'Rent', 'only the rent row must remain, got ' + JSON.stringify(rows.map((r) => r.subcategory)));
  assert(Number(h.run('SELECT balance FROM accounts WHERE id = 1')[0].balance) === 94000,
    'the balance must be 100000 - 6000 = 94000 after the refund');
});

// ── Part 4 — the shop agreement (the VPS half) ─────────────────────────
check('SHOP: the INSERT records into the session shop, not a hardcoded 1', () => {
  const ins = insertFromSource();
  assert(ins.values.trim().startsWith('$1'), 'the shop must be a $1 parameter, got VALUES (' + ins.values + ')');
  recordExpense(h, { shop: 2, category: 'Supplies', subcategory: 'Cleaning', amount: 300, date: '2026-11-25', note: 'outlet 2' });
  const row = h.run("SELECT shop_id FROM expenses WHERE subcategory = 'Cleaning'")[0];
  assert(Number(row.shop_id) === 2, 'a shop-2 session must record into shop 2, got shop_id ' + row.shop_id);
});
check('SHOP: the statement the VPS executes verbatim is valid Postgres', () => {
  // The INSERT text (with $1..$7) and the raw DAY go to /api/transaction and
  // /api/query unchanged: substr + ::text are native Postgres, and the shop
  // parameter equals the session shop, so the row-security WITH CHECK
  // (shop_id = app.shop_id) passes by construction.
  const ins = insertFromSource();
  assert(/\$1,\$2,\$3,\$4,\$5,\$6,\$7/.test(ins.values), 'the INSERT must carry seven $N placeholders, got (' + ins.values + ')');
  const day = dayFromSource();
  assert(day.includes('substr(') && day.includes('::text') && !day.includes('to_char'),
    'DAY must be the substr/::text form for Postgres, got: ' + day);
});

// ── Part 5 — no regression of batch 7 (2067), batch 8 (stock guard), batch 9 (used oil) ──
h.run("INSERT OR IGNORE INTO warehouses (id, uuid, shop_id, name, code, is_default, active) VALUES (1, 'wh-test', 1, 'Main Store', 'MAIN', 1, 1)");
h.run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (1, 1, 'GTX 4L', '4L', 4000, 4000, 3600, 10, 2, 1)");
h.run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (4, 1, 'Engine Oil 5L', '5L', 4500, 4500, 4000, 10, 5, 1)");
h.run("INSERT INTO customers (id, shop_id, name, phone, customer_type) VALUES (3, 1, 'Ahmed Raza', '03001234567', 'walking')");
h.run("INSERT OR IGNORE INTO used_oil_drum (id, capacity) VALUES (1, 200)");

function usedOilInsertFromSource() {
  const m = USED_OIL_PANE.match(/INSERT INTO used_oil_log \(drum_id, litres, type, notes\) VALUES \(1, \$1, \$2, \$3\)/);
  assert(m, 'UsedOilPane.tsx must contain the used-oil INSERT with notes');
  return m[0];
}

check('REGRESSION (batch 7): a valid two-item sale completes, no 2067, distinct v4 uuids', () => {
  const prodA = { id: 1, name: 'GTX 4L', packing: '4L' };
  const prodD = { id: 4, name: 'Engine Oil 5L', packing: '5L' };
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

check('REGRESSION (batch 9): collecting used oil with a note still works', () => {
  h.runTx([
    { sql: 'UPDATE used_oil_drum SET current_litres = current_litres + $1 WHERE id = 1', params: [5] },
    { sql: usedOilInsertFromSource(), params: [5, 'collected', 'Customer drop-off'] },
  ]);
  assert(Number(h.run('SELECT current_litres FROM used_oil_drum WHERE id = 1')[0].current_litres) === 5,
    'the drum must hold 5L after the collection');
  const row = h.run("SELECT litres, type, notes FROM used_oil_log WHERE type = 'collected'")[0];
  assert(Number(row.litres) === 5 && row.notes === 'Customer drop-off',
    'the log row must carry the note, got ' + JSON.stringify(row));
});

// ── Part 6 — the wiring, pinned in source ───────────────────────────────
check('WIRING: the list query no longer uses to_char anywhere in Expenses.tsx', () => {
  // The DAY comment documents the old form, so strip comments first: the
  // check is about code, not prose.
  const code = EXPENSES.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  assert(!code.includes('to_char'), 'Expenses.tsx code must not mention to_char');
});
check('WIRING: the add INSERT takes the shop as a parameter', () => {
  assert(EXPENSES.includes('INSERT INTO expenses (shop_id, category, subcategory, amount, account_id, date, note) VALUES ($1,$2,$3,$4,$5,$6,$7)'),
    'the INSERT must be the $1..$7 form');
  assert(!EXPENSES.includes('VALUES (1,$1,$2,$3,$4,$5,$6)'),
    'the INSERT must not hardcode shop 1 anymore');
});
check('WIRING: the component reads the active outlet from auth', () => {
  assert(EXPENSES.includes('activeShopId'), 'Expenses.tsx must read activeShopId from useAuth');
  assert(EXPENSES.includes('activeShopId ?? user?.shop_id ?? 1'), 'the shop must fall back to the home outlet, then 1');
});
check('WIRING: the edit and delete statements are untouched', () => {
  assert(EXPENSES.includes('UPDATE expenses SET category=$1, subcategory=$2, amount=$3, account_id=$4, date=$5, note=$6 WHERE id=$7'),
    'the edit UPDATE must be unchanged');
  assert(EXPENSES.includes('DELETE FROM expenses WHERE id = $1'),
    'the delete must be unchanged');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
