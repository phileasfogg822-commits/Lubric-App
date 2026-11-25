/**
 * Sales History + Dashboard trend — the same to_char hole as the Expenses
 * list (batch 10), in the two places the batch-10 fix did not reach:
 *
 *  1. src/modules/sales/SalesHistory.tsx:130 — the expense filter's DAY
 *     expression was the identical
 *     COALESCE(NULLIF(e.date, ''), to_char(e.created_at, 'YYYY-MM-DD')).
 *     With a from/to filter set, the filtered list query died locally with
 *     "no such function: to_char" — the same silent failure as the
 *     Expenses list: the page shows the unfiltered (or empty) history
 *     while the rows exist. Proven here against real SQLite: the old DAY
 *     throws, the new one filters.
 *  2. src/modules/dashboard/Dashboard.tsx — the trend queries used
 *     to_char + generate_series: the 7-day revenue trend was zero-filled
 *     by Postgres itself (RIGHT JOIN generate_series(...)), and the cost
 *     query grouped by to_char(o.created_at, 'YYYY-MM-DD') with a
 *     CURRENT_DATE - interval '6 days' bound. SQLite has neither
 *     to_char nor generate_series (nor interval arithmetic), so BOTH
 *     queries died locally and the revenue/cost/profit charts never
 *     rendered on the Windows app. The fix builds the 7-day window in JS
 *     (src/lib/trendDays.ts) and passes it as $N parameters into a UNION ALL
 *     series; the cost query takes the window start as $1. The same
 *     statements run verbatim on Postgres through /api/query.
 *
 * Out of scope here (flagged for a follow-up, same bug class, different
 * construct): the Dashboard's other interval uses — week sales
 * (now() - interval '7 days'), the 30-day brand/category/top-product
 * mixes, the 60-day inactive-customer and 7-day payables windows, and
 * the field-collections week window — each needs its own JS-computed
 * bound parameter. The today/counts queries use created_at::date, which
 * pgToSqlite strips to a plain equality that never matches a full
 * timestamp — valid SQLite, wrong semantics, also a follow-up.
 *
 * Run:  node --experimental-strip-types server/sim_sales_history_dashboard_trend.js
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
import { last7Days, trendDaysParams } from '../src/lib/trendDays.ts';

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
  function run(sql, params = []) {
    const b = sqlxBind(pgToSqlite(sql), params);
    return raw.prepare(b.sql).all(...b.params);
  }
  return { raw, run };
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

const SALES_HISTORY = readFileSync(new URL('../src/modules/sales/SalesHistory.tsx', import.meta.url), 'utf8');
const DASHBOARD = readFileSync(new URL('../src/modules/dashboard/Dashboard.tsx', import.meta.url), 'utf8');

// The REAL day expression, extracted from SalesHistory.tsx — not a copy.
function dayFromSource() {
  const m = SALES_HISTORY.match(/const DAY = "([^"]+)"/);
  assert(m, 'SalesHistory.tsx must define const DAY = "..."');
  return m[1];
}

// The REAL trend + cost queries, extracted from Dashboard.tsx — the
// template literal of each dbSelect call, not a copy. On the pre-fix code
// these are the generate_series / to_char forms; the extraction works on
// both, so the red-before run fails on the old SQL itself.
function trendSqlFromSource() {
  const m = DASHBOARD.match(/dbSelect<\{ day: string; label: string; revenue: number; orders: number \}>\(\s*`([\s\S]*?)`/);
  assert(m, 'Dashboard.tsx must contain the trend dbSelect');
  return m[1];
}
function costSqlFromSource() {
  const m = DASHBOARD.match(/dbSelect<\{ day: string; cost: number \}>\(\s*`([\s\S]*?)`/);
  assert(m, 'Dashboard.tsx must contain the cost dbSelect');
  return m[1];
}

// The component's exact expense filter, with the source-extracted DAY.
function listExpenses(h, { df = '', dt = '' } = {}) {
  const DAY = dayFromSource();
  const p = [];
  let w = 'WHERE 1=1';
  if (df) { p.push(df); w += ` AND ${DAY} >= $${p.length}`; }
  if (dt) { p.push(dt); w += ` AND ${DAY} <= $${p.length}`; }
  return h.run(
    `SELECT e.id, e.amount, e.category, e.date, e.created_at, ${DAY} AS day
     FROM expenses e
     ${w}
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 500`,
    p
  );
}

// Fixed "today" so the window is deterministic: 2026-11-19 (Thu) .. 2026-11-25 (Wed).
const NOW = new Date('2026-11-25T12:00:00Z');
const DAYS = last7Days(NOW);
const START = DAYS[0].day;

console.log('\nSales History + Dashboard trend: the to_char / generate_series reads must run locally');

// ── Setup ─────────────────────────────────────────────────────────────
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
await ensureLocalSchema({ execute: async (sql) => h.raw.exec(sql), select: async (sql) => h.raw.prepare(sql).all() });

// One product (cost 3000) for the cost query; three orders spread over the
// window, one cancelled, one outside it.
h.run("INSERT INTO products (id, shop_id, name, packing, cost_price, price_walking, price_returning, price_wholesale, stock_qty, active) VALUES (1, 1, 'GTX 4L', '4L', 3000, 4000, 4000, 3600, 10, 1)");
h.run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, created_at) VALUES (1, 1, NULL, 1, 4000, 4000, 1, 'cash', 'completed', '2026-11-23 10:15:00')");
h.run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, created_at) VALUES (2, 1, NULL, 1, 8000, 8000, 1, 'cash', 'completed', '2026-11-23 18:40:00')");
h.run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, created_at) VALUES (3, 1, NULL, 1, 4000, 4000, 1, 'cash', 'completed', '2026-11-25 09:00:00')");
h.run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, created_at) VALUES (4, 1, NULL, 1, 9999, 9999, 1, 'cash', 'cancelled', '2026-11-23 12:00:00')");
h.run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, created_at) VALUES (5, 1, NULL, 1, 7777, 7777, 1, 'cash', 'completed', '2026-11-10 09:00:00')");
h.run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total) VALUES (1, 'product', 1, 'GTX 4L', 1, 4000, 4000)");
h.run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total) VALUES (2, 'product', 1, 'GTX 4L', 2, 4000, 8000)");
h.run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total) VALUES (3, 'product', 1, 'GTX 4L', 1, 4000, 4000)");
h.run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total) VALUES (4, 'product', 1, 'GTX 4L', 1, 4000, 4000)");
h.run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total) VALUES (5, 'product', 1, 'GTX 4L', 1, 4000, 4000)");
h.run("INSERT INTO expenses (id, shop_id, category, subcategory, amount, account_id, date, note, created_at) VALUES (1, 1, 'Shop', 'Rent', 5000, 1, '2026-11-20', '', '2026-11-20 09:00:00')");
h.run("INSERT INTO expenses (id, shop_id, category, subcategory, amount, account_id, date, note, created_at) VALUES (2, 1, 'Food', 'Tea', 150, 1, '', '', '2026-11-25 08:00:00')");

// ── Part 1 — the Sales History DAY ─────────────────────────────────────
check('HISTORY: the DAY expression in source has no to_char', () => {
  const day = dayFromSource();
  assert(!day.includes('to_char'), 'DAY must not use to_char, got: ' + day);
  assert(day.includes('substr(') && day.includes('::text'), 'DAY must be the substr/::text form, got: ' + day);
});
check('HISTORY: pgToSqlite strips the ::text cast out of DAY', () => {
  const translated = pgToSqlite(dayFromSource());
  assert(!translated.includes('::'), 'pgToSqlite(DAY) must have no cast left, got: ' + translated);
  assert(translated.includes('substr(e.created_at, 1, 10)'), 'pgToSqlite(DAY) must be the substr form, got: ' + translated);
});
check('HISTORY: the filtered list query runs on SQLite (no to_char)', () => {
  const rows = listExpenses(h);
  assert(rows.length === 2, 'the unfiltered list must show both expenses, got ' + rows.length);
});
check('HISTORY: a dated row keeps its date, a blank date falls back to the created day', () => {
  const rows = listExpenses(h);
  const rent = rows.find((r) => r.category === 'Shop');
  const tea = rows.find((r) => r.category === 'Food');
  assert(rent && rent.day === '2026-11-20', 'the rent row must read 2026-11-20, got ' + JSON.stringify(rent));
  assert(tea && tea.day === '2026-11-25', 'the blank-date row must fall back to its created day, got ' + JSON.stringify(tea));
});
check('HISTORY: the from/to filter hides out-of-range rows', () => {
  assert(listExpenses(h, { df: '2026-11-21' }).length === 1, 'from 2026-11-21 must keep only the tea row');
  assert(listExpenses(h, { df: '2026-11-20', dt: '2026-11-20' }).length === 1, 'the 2026-11-20 window must keep only the rent row');
});

// ── Part 2 — the trend query ───────────────────────────────────────────
check('TREND: the query in source has no to_char, generate_series or interval', () => {
  const sql = trendSqlFromSource();
  assert(!sql.includes('to_char'), 'the trend query must not use to_char');
  assert(!sql.includes('generate_series'), 'the trend query must not use generate_series');
  assert(!sql.includes('interval'), 'the trend query must not use interval arithmetic');
});
check('TREND: the query runs on SQLite and returns exactly the 7 window days, in order', () => {
  const rows = h.run(trendSqlFromSource(), trendDaysParams(DAYS));
  assert(rows.length === 7, 'the trend must return 7 rows, got ' + rows.length);
  const days = rows.map((r) => r.day);
  assert(JSON.stringify(days) === JSON.stringify(DAYS.map((d) => d.day)),
    'the rows must be the 7 window days in order, got ' + JSON.stringify(days));
});
check('TREND: quiet days are zero-filled (revenue 0, orders 0)', () => {
  const rows = h.run(trendSqlFromSource(), trendDaysParams(DAYS));
  for (const d of ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-24']) {
    const r = rows.find((x) => x.day === d);
    assert(r && Number(r.revenue) === 0 && Number(r.orders) === 0,
      d + ' must be zero-filled, got ' + JSON.stringify(r));
  }
});
check('TREND: completed orders sum into their own day only', () => {
  const rows = h.run(trendSqlFromSource(), trendDaysParams(DAYS));
  const mon = rows.find((r) => r.day === '2026-11-23');
  assert(Number(mon.revenue) === 12000 && Number(mon.orders) === 2,
    '2026-11-23 must show 12000 over 2 orders, got ' + JSON.stringify(mon));
  const wed = rows.find((r) => r.day === '2026-11-25');
  assert(Number(wed.revenue) === 4000 && Number(wed.orders) === 1,
    '2026-11-25 must show 4000 over 1 order, got ' + JSON.stringify(wed));
});
check('TREND: a cancelled order and an out-of-window order never count', () => {
  const rows = h.run(trendSqlFromSource(), trendDaysParams(DAYS));
  const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
  assert(total === 16000, 'the 7-day total must be 16000 (cancelled 9999 + outside 7777 excluded), got ' + total);
  assert(rows.reduce((s, r) => s + Number(r.orders), 0) === 3, 'only the 3 completed in-window orders must count');
});
check('TREND: the labels are the weekday abbreviations for each day', () => {
  const rows = h.run(trendSqlFromSource(), trendDaysParams(DAYS));
  const labels = Object.fromEntries(rows.map((r) => [r.day, r.label]));
  assert(labels['2026-11-19'] === 'Thu' && labels['2026-11-22'] === 'Sun' && labels['2026-11-25'] === 'Wed',
    'labels must be Thu/Sun/Wed for 19/22/25, got ' + JSON.stringify(labels));
});

// ── Part 3 — the cost query ────────────────────────────────────────────
check('COST: the query in source has no to_char or interval', () => {
  const sql = costSqlFromSource();
  assert(!sql.includes('to_char'), 'the cost query must not use to_char');
  assert(!sql.includes('interval'), 'the cost query must not use interval arithmetic');
});
check('COST: the query runs on SQLite and sums qty x cost_price per day', () => {
  const rows = h.run(costSqlFromSource(), [START]);
  const byDay = Object.fromEntries(rows.map((r) => [r.day, Number(r.cost)]));
  assert(byDay['2026-11-23'] === 9000, '2026-11-23 cost must be 3 units x 3000 = 9000, got ' + JSON.stringify(byDay));
  assert(byDay['2026-11-25'] === 3000, '2026-11-25 cost must be 1 unit x 3000 = 3000, got ' + JSON.stringify(byDay));
});
check('COST: cancelled and out-of-window orders contribute no cost', () => {
  const rows = h.run(costSqlFromSource(), [START]);
  assert(!rows.some((r) => r.day === '2026-11-10'), 'the out-of-window day must not appear, got ' + JSON.stringify(rows.map((r) => r.day)));
  assert(rows.reduce((s, r) => s + Number(r.cost), 0) === 12000, 'total cost must be 12000, got ' + rows.reduce((s, r) => s + Number(r.cost), 0));
});

// ── Part 4 — the component merge, as the Dashboard does it ─────────────
check('MERGE: the cost rows join the trend rows by day key, zero-filled', () => {
  const trend = h.run(trendSqlFromSource(), trendDaysParams(DAYS));
  const costByDay = new Map(h.run(costSqlFromSource(), [START]).map((r) => [r.day, Number(r.cost)]));
  const merged = trend.map((r) => ({ day: r.day, revenue: Number(r.revenue), cost: costByDay.get(r.day) ?? 0 }));
  assert(merged.length === 7, 'the merged trend must still have 7 days');
  assert(merged.find((r) => r.day === '2026-11-23').cost === 9000, '2026-11-23 must merge cost 9000');
  assert(merged.find((r) => r.day === '2026-11-19').cost === 0, 'a quiet day must merge cost 0');
  assert(merged.find((r) => r.day === '2026-11-23').revenue - merged.find((r) => r.day === '2026-11-23').cost === 3000,
    '2026-11-23 profit must be 12000 - 9000 = 3000');
});

// ── Part 5 — the statements the VPS executes verbatim ──────────────────
check('POSTGRES: the trend query is a UNION ALL series with $1..$14 in (day, label) order', () => {
  const sql = trendSqlFromSource();
  assert(sql.includes('SELECT $1 AS day, $2 AS label'), 'the series must start SELECT $1 AS day, $2 AS label');
  assert(sql.includes('UNION ALL SELECT $13, $14'), 'the series must end UNION ALL SELECT $13, $14');
  assert(sql.includes('substr(o.created_at::text, 1, 10) = d.day'),
    'the join must use the substr/::text day key');
  const params = trendDaysParams(DAYS);
  assert(params.length === 14 && params[0] === '2026-11-19' && params[1] === 'Thu' && params[12] === '2026-11-25' && params[13] === 'Wed',
    'the params must be (day, label) pairs in window order, got ' + JSON.stringify(params));
});
check('POSTGRES: the cost query takes the window start as $1 and groups by day', () => {
  const sql = costSqlFromSource();
  assert(sql.includes('substr(o.created_at::text, 1, 10) >= $1'), 'the cost window must be a $1 day bound');
  assert(sql.includes('substr(o.created_at::text, 1, 10) AS day'), 'the cost day must be the substr/::text form');
});

// ── Part 6 — the helper and the wiring, pinned in source ───────────────
check('HELPER: last7Days is deterministic — 7 UTC days, oldest first, with weekday labels', () => {
  const days = last7Days(NOW);
  assert(days.length === 7, 'last7Days must return 7 days');
  assert(days[0].day === '2026-11-19' && days[0].label === 'Thu', 'the first day must be 2026-11-19 Thu, got ' + JSON.stringify(days[0]));
  assert(days[6].day === '2026-11-25' && days[6].label === 'Wed', 'the last day must be 2026-11-25 Wed, got ' + JSON.stringify(days[6]));
  assert(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day)), 'every day must be YYYY-MM-DD');
  assert(JSON.stringify(last7Days(NOW)) === JSON.stringify(days), 'the same now must give the same window');
});
check('WIRING: SalesHistory.tsx code mentions to_char nowhere', () => {
  const code = SALES_HISTORY.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  assert(!code.includes('to_char'), 'SalesHistory.tsx code must not mention to_char');
});
check('WIRING: Dashboard.tsx code mentions to_char / generate_series nowhere', () => {
  const code = DASHBOARD.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  assert(!code.includes('to_char'), 'Dashboard.tsx code must not mention to_char');
  assert(!code.includes('generate_series'), 'Dashboard.tsx code must not mention generate_series');
});
check('WIRING: the Dashboard passes the JS-built window into both queries', () => {
  assert(DASHBOARD.includes('last7Days()'), 'Dashboard.tsx must build the window with last7Days()');
  assert(DASHBOARD.includes('trendDaysParams(trendDays)'), 'the trend query must take trendDaysParams(trendDays)');
  assert(DASHBOARD.includes('[trendDays[0].day]'), 'the cost query must take [trendDays[0].day]');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
