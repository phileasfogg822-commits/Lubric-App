/**
 * Service sale + auto service reminder — "error returned from database:
 * (code: 1) near "FROM": syntax error" (Umar, 2026-11-25 ~23:23 PKT, on
 * the Windows app, v11).
 *
 * Report: starting a fresh sale, adding a customer, then adding a service
 * fails with that error — but with no customer the sale completes, and a
 * new sale on the customer/bill page with the same user bills fine.
 *
 * Root cause, proven from the code and against real SQLite — the auto
 * service reminder INSERT in completeSale (src/modules/pos/POSCart.tsx),
 * which only runs when the cart has a service AND a vehicle id is set:
 *
 *  1. The title expression was
 *     NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', v.make, v.model,
 *     v.registration)), ''). SQLite has no TRIM(BOTH FROM ...) and no
 *     CONCAT_WS, and pgToSqlite has no rule for either — so the read
 *     died with exactly 'near "FROM": syntax error'. No customer means
 *     no vehicle, so the statement never runs and the sale completes;
 *     on the bill page the vehicle was not attached, so it skipped too.
 *     Proven here against real SQLite: the old expression throws the
 *     exact reported error, the new one returns the label.
 *  2. Second latent failure in the SAME statement:
 *     now() + (v.service_interval_days || ' days')::interval — ::interval
 *     is not in pgToSqlite's cast-strip list, so SQLite dies with
 *     'unrecognized token: ":"' right after the TRIM is fixed.
 *
 * Fix:
 *  - The title is now plain || concatenation with COALESCE, valid on
 *    both engines (a NULL middle field leaves a double space inside
 *    the title, cosmetic only).
 *  - pgToSqlite gains a rule translating
 *    `<expr> + (<n> || ' days')::interval` to
 *    `datetime(<expr>, '+' || <n> || ' days')`, run before the NOW()
 *    rule so `now() + ...` becomes datetime(datetime('now'), ...).
 *  - The same TRIM/CONCAT_WS construct in REMINDER_SELECT
 *    (src/lib/reminders.ts) and the ReminderModal vehicle label query
 *    used the identical form through dbSelect locally, so the bell, the
 *    dashboard panel, the Reminders page and the modal's vehicle picker
 *    all died the same way — fixed with the same portable expression.
 *  - The recurrence re-insert (completing a recurring reminder) was a
 *    single Postgres statement — WITH d AS (UPDATE ... RETURNING *)
 *    INSERT ... SELECT due_at + (recurrence_days || ' days')::interval
 *    — and SQLite supports neither a data-modifying CTE ('near
 *    "UPDATE": syntax error', proven here) nor ::interval. It is now
 *    the shared lib/reminders.ts actOnReminder helper: read the row,
 *    UPDATE it, then re-INSERT the shifted copy (the ::interval there
 *    is translated by the new pgToSqlite rule). The pending-only guard
 *    makes a double tap idempotent.
 *  - Server migration 011_reminders.sql adds the vehicle interval
 *    columns as NOT NULL DEFAULT 60 / 3000, but the local patch added
 *    them as bare INTEGER — so a Windows-created vehicle carried NULL
 *    intervals and the reminder would have been created with a NULL
 *    due date and NULL due km. The patch decl now matches the server,
 *    and patchVehicleServiceIntervals backfills NULLs on existing
 *    databases.
 *
 * The gap that let this ship: server/sim_sale_permissions.js embeds
 * the reminder INSERT only as text for permission checks and never
 * runs it — no sim ever executed a service + vehicle sale through
 * real SQLite. This sim does, with the REAL pgToSqlite and the REAL
 * statement text extracted from source.
 *
 * Out of scope here (flagged for a follow-up, same bug class,
 * different construct): the Dashboard's other interval uses — week
 * sales (now() - interval '7 days'), the 30-day brand/category/
 * top-product mixes, the 60-day inactive-customer and 7-day payables
 * windows, and the field-collections week window (already flagged in
 * batch 11) — each needs its own JS-computed bound parameter. The
 * today/counts queries use created_at::date, which pgToSqlite strips
 * to a plain equality that never matches a full timestamp — valid
 * SQLite, wrong semantics, also a follow-up.
 *
 * Run:  node --experimental-strip-types server/sim_sale_service_reminder.js
 */

import { readFileSync } from 'node:fs';
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

// ── sqlx-faithful binding (copied from sim_expenses_list.js) ─────────
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

const POSCART = readFileSync(new URL('../src/modules/pos/POSCart.tsx', import.meta.url), 'utf8');
const REMINDERS_LIB = readFileSync(new URL('../src/lib/reminders.ts', import.meta.url), 'utf8');
const MODAL = readFileSync(new URL('../src/components/ReminderModal.tsx', import.meta.url), 'utf8');
const PERM_SIM = readFileSync(new URL('./sim_sale_permissions.js', import.meta.url), 'utf8');
const LOCALDB = readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');

// The REAL reminder INSERT, extracted from POSCart.tsx — not a copy.
function reminderInsertFromSource() {
  const start = POSCART.indexOf('`INSERT INTO reminders');
  assert(start >= 0, 'POSCart.tsx must contain the reminder INSERT');
  const end = POSCART.indexOf('`,', start);
  assert(end > start, 'the reminder INSERT literal must close');
  return POSCART.slice(start + 1, end);
}

// The REAL shared list select, extracted from lib/reminders.ts.
function reminderSelectFromSource() {
  const start = REMINDERS_LIB.indexOf('export const REMINDER_SELECT = `');
  assert(start >= 0, 'reminders.ts must define REMINDER_SELECT');
  const open = REMINDERS_LIB.indexOf('`', start + 'export const REMINDER_SELECT = '.length);
  const end = REMINDERS_LIB.indexOf('`;', open);
  assert(end > open, 'REMINDER_SELECT literal must close');
  return REMINDERS_LIB.slice(open + 1, end);
}

// The REAL modal vehicle-label query, extracted from ReminderModal.tsx.
function modalLabelQueryFromSource() {
  const start = MODAL.indexOf('`SELECT id, COALESCE(NULLIF(TRIM(');
  assert(start >= 0, 'ReminderModal.tsx must contain the vehicle label query');
  const end = MODAL.indexOf('`,', start);
  assert(end > start, 'the modal label query literal must close');
  return MODAL.slice(start + 1, end);
}

// The REAL recurrence re-INSERT from the actOnReminder helper.
function recurrenceInsertFromSource() {
  const start = REMINDERS_LIB.indexOf('`INSERT INTO reminders (shop_id, kind, title, details, due_at, due_km, last_mileage,');
  assert(start >= 0, 'reminders.ts actOnReminder must contain the re-INSERT');
  const end = REMINDERS_LIB.indexOf('`,', start);
  assert(end > start, 'the re-INSERT literal must close');
  return REMINDERS_LIB.slice(start + 1, end);
}

// The pre-fix recurrence form, kept ONLY to prove SQLite rejects it.
const OLD_CTE = `WITH d AS (UPDATE reminders SET status='done', completed_at=datetime('now'), updated_at=datetime('now') WHERE id=1 RETURNING *)
INSERT INTO reminders (shop_id, kind, title, details, due_at, due_km, last_mileage,
  customer_id, vehicle_id, vendor_id, order_id, priority, recurrence_days, created_by_user_id)
SELECT shop_id, kind, title, details, due_at + (recurrence_days || ' days')::interval,
  due_km, last_mileage, customer_id, vehicle_id, vendor_id, order_id, priority,
  recurrence_days, created_by_user_id
FROM d WHERE 'done' = 'done' AND recurrence_days IS NOT NULL`;

// The pre-fix title expression, kept ONLY to prove SQLite rejects it.
const OLD_TITLE = `SELECT NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', make, model, registration)), '') FROM vehicles`;

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function parseSqliteTs(s) {
  // 'YYYY-MM-DD HH:MM:SS' from datetime() -> UTC ms.
  return Date.parse(s.replace(' ', 'T') + 'Z');
}

console.log('\nService sale + auto service reminder: the sale must complete and the reminder must land');

// ── Part 1 — the old forms die on real SQLite, the new ones translate ──
check('OLD TITLE: TRIM(BOTH FROM CONCAT_WS(...)) throws exactly the reported error', () => {
  const h = makeDb();
  h.raw.exec('CREATE TABLE vehicles (make TEXT, model TEXT, registration TEXT)');
  h.raw.exec("INSERT INTO vehicles VALUES ('Toyota', 'Corolla', 'ABC-123')");
  let err = null;
  try { h.run(OLD_TITLE); } catch (e) { err = e; }
  assert(err && /near "FROM": syntax error/.test(err.message),
    'the old title must throw near "FROM": syntax error, got: ' + (err && err.message));
});

check('OLD INTERVAL: ::interval dies with unrecognized token ":"', () => {
  // The form as pgToSqlite left it before this batch (NOW() translated,
  // ::interval untouched — it was not in the cast-strip list), run
  // against raw SQLite with no translation.
  const h = makeDb();
  let err = null;
  try { h.raw.prepare("SELECT datetime('now') + (60 || ' days')::interval").all(); } catch (e) { err = e; }
  assert(err && /unrecognized token/.test(err.message),
    'the old due_at must throw unrecognized token, got: ' + (err && err.message));
});

check('OLD CTE: a data-modifying CTE dies with near "UPDATE"', () => {
  const h = makeDb();
  h.raw.exec('CREATE TABLE reminders (id INTEGER PRIMARY KEY, status TEXT, due_at TEXT, recurrence_days INTEGER)');
  h.raw.exec("INSERT INTO reminders VALUES (1, 'pending', '2026-11-01 10:00:00', 30)");
  let err = null;
  try { h.run(OLD_CTE); } catch (e) { err = e; }
  assert(err && /near "UPDATE": syntax error/.test(err.message),
    'the old CTE must throw near "UPDATE", got: ' + (err && err.message));
});

check('NEW: pgToSqlite translates the reminder INSERT with no :: left', () => {
  const t = pgToSqlite(reminderInsertFromSource());
  assert(!t.includes('::'), 'translated INSERT must have no cast left, got: ' + t);
  assert(!/TRIM\s*\(\s*BOTH/i.test(t) && !/CONCAT_WS/i.test(t),
    'translated INSERT must not mention TRIM(BOTH / CONCAT_WS, got: ' + t);
  assert(t.includes("datetime(datetime('now'), '+' || v.service_interval_days || ' days')"),
    'the due_at must be the datetime form, got: ' + t);
  assert(t.includes("TRIM(COALESCE(v.make, '') || ' ' || COALESCE(v.model, '') || ' ' || COALESCE(v.registration, ''))"),
    'the title must be the portable || form, got: ' + t);
});

check('NEW: the interval rule covers both written forms and leaves the literal form alone', () => {
  assert(pgToSqlite("SELECT now() + (v.service_interval_days || ' days')::interval")
    .includes("datetime(datetime('now'), '+' || v.service_interval_days || ' days')"),
    'now() + interval must translate');
  assert(pgToSqlite("SELECT due_at + (recurrence_days || ' days')::interval")
    .includes("datetime(due_at, '+' || recurrence_days || ' days')"),
    'due_at + interval must translate');
  // The `interval 'N days'` literal form (Dashboard payables) is a
  // different construct and deliberately NOT covered here.
  assert(pgToSqlite("SELECT now() + interval '7 days'").includes("interval '7 days'"),
    'the literal interval form must be left alone for the follow-up');
});

check('NEW: the source text stays valid Postgres verbatim', () => {
  const src = reminderInsertFromSource();
  assert(src.includes("::interval"), 'the source must keep ::interval for Postgres');
  assert(!src.includes('TRIM(BOTH') && !src.includes('CONCAT_WS'),
    'the source title must be the portable form, got: ' + src);
  const rec = recurrenceInsertFromSource();
  assert(rec.includes("due_at + (recurrence_days || ' days')::interval"),
    'the re-INSERT must keep the Postgres interval form, got: ' + rec);
});

// ── Part 2 — the database: upgrade path, then the sale ─────────────────
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
// A database from before this batch: the interval columns exist from the
// OLD bare-INTEGER patch decl, and the vehicle carries NULL intervals.
h.raw.exec('ALTER TABLE vehicles ADD COLUMN service_interval_days INTEGER');
h.raw.exec('ALTER TABLE vehicles ADD COLUMN service_interval_km INTEGER');
h.raw.exec("INSERT INTO customers (id, shop_id, name, phone, customer_type) VALUES (1, 1, 'Jane', '03001112222', 'returning')");
h.raw.exec("INSERT INTO vehicles (id, customer_id, registration, make, model, model_year, color, \"condition\", mileage) VALUES (1, 1, 'ABC-123', 'Toyota', 'Corolla', '2022', 'Silver', 'good', 45000)");
await ensureLocalSchema(h.db);

check('DEFAULTS (upgrade): a pre-existing vehicle with NULL intervals gets 60 / 3000', () => {
  const v = h.run('SELECT service_interval_days, service_interval_km FROM vehicles WHERE id = 1')[0];
  assert(Number(v.service_interval_days) === 60 && Number(v.service_interval_km) === 3000,
    'the backfill must set 60 / 3000, got ' + JSON.stringify(v));
});

check('DEFAULTS (fresh): a vehicle created after the schema carries 60 / 3000', () => {
  // A separate fresh database. ensureLocalSchema is once-per-process
  // (module-level memo), so it cannot run again here — instead the
  // patch decl itself is applied, which is exactly what
  // patchSyncColumns does on a fresh install. The decl text is pinned
  // by the wiring check below, so the two halves together prove the
  // fresh-install behaviour.
  const h2 = makeDb();
  h2.raw.exec(LOCAL_SCHEMA);
  h2.raw.exec(LOCAL_SCHEMA_2);
  h2.raw.exec(LOCAL_SCHEMA_3);
  h2.raw.exec(LOCAL_SCHEMA_4);
  h2.raw.exec(LOCAL_SCHEMA_5);
  h2.raw.exec(LOCAL_SCHEMA_6);
  h2.raw.exec(LOCAL_SCHEMA_7);
  h2.raw.exec(LOCAL_SCHEMA_8);
  h2.raw.exec(LOCAL_SCHEMA_9);
  h2.raw.exec('ALTER TABLE vehicles ADD COLUMN service_interval_days INTEGER NOT NULL DEFAULT 60');
  h2.raw.exec('ALTER TABLE vehicles ADD COLUMN service_interval_km INTEGER NOT NULL DEFAULT 3000');
  h2.raw.exec("INSERT INTO vehicles (customer_id, registration, make, model, mileage) VALUES (1, 'XYZ-9', 'Honda', 'Civic', 12000)");
  const v = h2.run("SELECT service_interval_days, service_interval_km FROM vehicles WHERE registration = 'XYZ-9'")[0];
  assert(Number(v.service_interval_days) === 60 && Number(v.service_interval_km) === 3000,
    'the column default must be 60 / 3000, got ' + JSON.stringify(v));
});

// The sale's statements, built the way completeSale builds them: order,
// the service line (verbatim 13-placeholder form), account movement,
// and — only when the cart has a service AND a vehicle — the reminder
// INSERT extracted from source.
const ORDER_ITEMS_SQL = `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`;
function saleStatements({ oid, customerId, userId, vehicleId, mileage, total, service }) {
  const stmts = [
    { sql: `INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, vehicle_id, mileage, notes, created_at) VALUES ($1, 1, $2, $3, $4, $4, $5, 'cash', 'completed', $6, $7, $8, NOW())`,
      params: [oid, customerId, userId, total, 1, vehicleId, mileage, 'Oil change'] },
  ];
  if (service) {
    stmts.push({ sql: ORDER_ITEMS_SQL,
      params: [oid, 'service', 1, 'Oil Change', 1, 1500, 1500, null, 0, 0, 'customer', false, false] });
  }
  stmts.push({ sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [total, 1] });
  stmts.push({ sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1, $2, 'in', $3)", params: [1, total, `Order #${oid}`] });
  if (customerId) {
    stmts.push({ sql: 'UPDATE customers SET last_visit_at = NOW() WHERE id = $1', params: [customerId] });
  }
  if (service && vehicleId) {
    stmts.push({ sql: reminderInsertFromSource(), params: [oid, mileage, userId, vehicleId] });
  }
  return stmts;
}

check('SALE: a service + customer + vehicle sale completes on SQLite (the reported failure)', () => {
  h.runTx(saleStatements({ oid: 1, customerId: 1, userId: 1, vehicleId: 1, mileage: 45000, total: 1500, service: true }));
  const o = h.run('SELECT id, status, vehicle_id FROM orders WHERE id = 1')[0];
  assert(o && o.status === 'completed' && Number(o.vehicle_id) === 1, 'the order must land, got ' + JSON.stringify(o));
  const li = h.run("SELECT kind, product_name FROM order_items WHERE order_id = 1");
  assert(li.length === 1 && li[0].kind === 'service' && li[0].product_name === 'Oil Change',
    'the service line must land, got ' + JSON.stringify(li));
});

check('SALE: the reminder lands with the right title, due date and due km', () => {
  const r = h.run("SELECT * FROM reminders WHERE kind = 'service_due'")[0];
  assert(r, 'one service_due reminder must exist');
  assert(r.title === 'Service due: Toyota Corolla ABC-123 (Jane)',
    'the title must name the vehicle and customer, got: ' + r.title);
  assert(r.details === 'Next oil change / service for Jane — about 3000 km from the last visit.',
    'the details must carry the interval, got: ' + r.details);
  const dueMs = parseSqliteTs(r.due_at);
  const expectedMs = Date.now() + 60 * 86400_000;
  assert(Math.abs(dueMs - expectedMs) < 10 * 60_000,
    'due_at must be ~60 days out, got ' + r.due_at);
  assert(Number(r.due_km) === 48000, 'due_km must be mileage 45000 + 3000, got ' + r.due_km);
  assert(Number(r.last_mileage) === 45000, 'last_mileage must be 45000, got ' + r.last_mileage);
  assert(r.status === 'pending' && Number(r.customer_id) === 1 && Number(r.vehicle_id) === 1 && Number(r.order_id) === 1,
    'the reminder must point at the sale, got ' + JSON.stringify(r));
});

check('SALE: a second service sale for the same vehicle creates NO second pending reminder', () => {
  h.runTx(saleStatements({ oid: 2, customerId: 1, userId: 1, vehicleId: 1, mileage: 45200, total: 1500, service: true }));
  const rows = h.run("SELECT id FROM reminders WHERE kind = 'service_due' AND status = 'pending'");
  assert(rows.length === 1, 'the NOT EXISTS dedup must keep exactly one pending reminder, got ' + rows.length);
});

check('SALE: a product-only sale creates no reminder (the guard needs a service)', () => {
  const before = h.run("SELECT COUNT(*) AS c FROM reminders")[0].c;
  h.runTx(saleStatements({ oid: 3, customerId: 1, userId: 1, vehicleId: 1, mileage: 45300, total: 4000, service: false }));
  assert(Number(h.run("SELECT COUNT(*) AS c FROM reminders")[0].c) === Number(before),
    'a sale with no service must not add a reminder');
});

check('SALE: a service sale with no vehicle creates no reminder (the guard needs a vehicle)', () => {
  const before = h.run("SELECT COUNT(*) AS c FROM reminders")[0].c;
  h.runTx(saleStatements({ oid: 4, customerId: null, userId: 1, vehicleId: null, mileage: 0, total: 1500, service: true }));
  assert(Number(h.run("SELECT COUNT(*) AS c FROM reminders")[0].c) === Number(before),
    'a service sale with no vehicle must not add a reminder');
});

// ── Part 3 — the reads: list, modal picker ─────────────────────────────
check('READ: REMINDER_SELECT runs locally and labels the vehicle', () => {
  const rows = h.run(reminderSelectFromSource() + " WHERE r.kind = 'service_due'");
  assert(rows.length === 1, 'the list must return the reminder, got ' + rows.length);
  assert(rows[0].vehicle_label === 'Toyota Corolla ABC-123',
    'vehicle_label must be the joined label, got: ' + rows[0].vehicle_label);
  assert(rows[0].about === 'Jane', 'about must prefer the customer name, got: ' + rows[0].about);
  assert(rows[0].customer_name === 'Jane', 'customer_name must join through');
});

check('READ: a vehicle with no make/model falls back to the customer name', () => {
  h.run("INSERT INTO vehicles (customer_id, registration, make, model, mileage) VALUES (1, 'NONAME-1', NULL, NULL, 0)");
  h.run("INSERT INTO reminders (shop_id, kind, title, details, due_at, customer_id, vehicle_id, status) VALUES (1, 'todo', 'Call back', '', '2026-12-01 09:00:00', 1, 3, 'pending')");
  const rows = h.run(reminderSelectFromSource() + " WHERE r.title = 'Call back'");
  assert(rows.length === 1, 'the row must list');
  assert(rows[0].vehicle_label === null || rows[0].vehicle_label === '',
    'an empty label must NULLIF to null/empty, got: ' + JSON.stringify(rows[0].vehicle_label));
  assert(rows[0].about === 'Jane', 'about must fall back to the customer, got: ' + rows[0].about);
});

check('READ: the modal vehicle-label query runs locally', () => {
  const rows = h.run(modalLabelQueryFromSource(), [1]);
  const labels = rows.map((r) => r.label);
  assert(labels.includes('Toyota Corolla ABC-123'), 'the picker must list the vehicle, got: ' + JSON.stringify(labels));
  assert(h.run(modalLabelQueryFromSource(), [999]).length === 0, 'an unknown customer must list no vehicles');
});

// ── Part 4 — the recurrence act, through the helper's SQL ──────────────
// Mirrors lib/reminders.ts actOnReminder: read, skip unless pending,
// UPDATE, then re-INSERT the shifted copy when done + recurring.
function act(h, id, mode) {
  const r = h.run('SELECT * FROM reminders WHERE id = $1', [id])[0];
  if (!r || r.status !== 'pending') return;
  h.runExecute('UPDATE reminders SET status=$2, completed_at=now(), updated_at=now() WHERE id=$1', [id, mode]);
  if (mode === 'done' && r.recurrence_days != null) {
    h.runExecute(recurrenceInsertFromSource(), [id]);
  }
}

check('ACT: completing a recurring reminder re-creates it shifted by the recurrence', () => {
  h.run("INSERT INTO reminders (shop_id, kind, title, details, due_at, due_km, customer_id, vehicle_id, priority, recurrence_days, created_by_user_id, status) VALUES (1, 'todo', 'Monthly check', 'Check the drum', '2026-11-01 10:00:00', 100, 1, 1, 'normal', 30, 1, 'pending')");
  const id = h.run("SELECT id FROM reminders WHERE title = 'Monthly check'")[0].id;
  act(h, id, 'done');
  const orig = h.run('SELECT status FROM reminders WHERE id = $1', [id])[0];
  assert(orig.status === 'done', 'the original must be done');
  const next = h.run("SELECT * FROM reminders WHERE title = 'Monthly check' AND status = 'pending'");
  assert(next.length === 1, 'exactly one next occurrence must exist, got ' + next.length);
  assert(next[0].due_at === '2026-12-01 10:00:00',
    'the next due date must shift 30 days, got: ' + next[0].due_at);
  assert(Number(next[0].due_km) === 100 && Number(next[0].recurrence_days) === 30,
    'the next occurrence must copy km + recurrence, got ' + JSON.stringify(next[0]));
});

check('ACT: completing a non-recurring reminder creates nothing', () => {
  const before = h.run("SELECT COUNT(*) AS c FROM reminders")[0].c;
  const id = h.run("SELECT id FROM reminders WHERE title = 'Call back'")[0].id;
  act(h, id, 'done');
  assert(Number(h.run("SELECT COUNT(*) AS c FROM reminders")[0].c) === Number(before),
    'no new row must appear for a one-off reminder');
});

check('ACT: dismissing a recurring reminder creates nothing', () => {
  const before = h.run("SELECT COUNT(*) AS c FROM reminders")[0].c;
  const id = h.run("SELECT id FROM reminders WHERE title = 'Monthly check' AND status = 'pending'")[0].id;
  act(h, id, 'dismissed');
  assert(Number(h.run("SELECT COUNT(*) AS c FROM reminders")[0].c) === Number(before),
    'dismissing must not re-create the reminder');
  assert(h.run('SELECT status FROM reminders WHERE id = $1', [id])[0].status === 'dismissed',
    'the row must be dismissed');
});

check('ACT: completing the same reminder twice creates only one next occurrence', () => {
  h.run("INSERT INTO reminders (shop_id, kind, title, details, due_at, recurrence_days, status) VALUES (1, 'todo', 'Twice check', '', '2026-11-05 09:00:00', 7, 'pending')");
  const id = h.run("SELECT id FROM reminders WHERE title = 'Twice check'")[0].id;
  act(h, id, 'done');
  act(h, id, 'done');
  const next = h.run("SELECT id FROM reminders WHERE title = 'Twice check' AND status = 'pending'");
  assert(next.length === 1, 'a double tap must not duplicate the next occurrence, got ' + next.length);
});

// ── Part 5 — wiring, pinned in source ──────────────────────────────────
check('WIRING: no TRIM(BOTH / CONCAT_WS in POSCart, reminders.ts or ReminderModal code', () => {
  for (const [name, code] of [['POSCart.tsx', POSCART], ['reminders.ts', REMINDERS_LIB], ['ReminderModal.tsx', MODAL]]) {
    const c = stripComments(code);
    assert(!c.includes('TRIM(BOTH') && !c.includes('CONCAT_WS'),
      name + ' code must not mention TRIM(BOTH / CONCAT_WS');
  }
});

check('WIRING: the sale reminder is guarded by service AND vehicle', () => {
  assert(/if\s*\(\s*hasService && vehicleId\s*\)/.test(POSCART),
    'POSCart.tsx must guard the reminder with hasService && vehicleId');
});

check('WIRING: the three act() sites use the shared helper, no CTE left', () => {
  for (const f of ['../src/components/NotificationBell.tsx', '../src/modules/dashboard/Dashboard.tsx', '../src/modules/reminders/Reminders.tsx']) {
    const code = stripComments(readFileSync(new URL(f, import.meta.url), 'utf8'));
    assert(code.includes('actOnReminder'), f + ' must call actOnReminder');
    assert(!code.includes('WITH d AS (UPDATE'), f + ' must not contain the old CTE');
  }
});

check('WIRING: sim_sale_permissions.js embeds the fixed reminder text', () => {
  const src = reminderInsertFromSource();
  const titleLine = src.split('\n').find((l) => l.includes('Service due:'));
  assert(titleLine && PERM_SIM.includes(titleLine.trim()),
    'sim_sale_permissions.js must embed the fixed title line');
  assert(!PERM_SIM.includes('TRIM(BOTH'), 'sim_sale_permissions.js must not embed the old title');
});

check('WIRING: the patch decls match the server defaults 60 / 3000', () => {
  assert(LOCALDB.includes('{ table: "vehicles", column: "service_interval_days", decl: "INTEGER NOT NULL DEFAULT 60" }'),
    'the days patch must carry NOT NULL DEFAULT 60');
  assert(LOCALDB.includes('{ table: "vehicles", column: "service_interval_km", decl: "INTEGER NOT NULL DEFAULT 3000" }'),
    'the km patch must carry NOT NULL DEFAULT 3000');
  assert(LOCALDB.includes('patchVehicleServiceIntervals'),
    'localDb.ts must define and call the backfill');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
