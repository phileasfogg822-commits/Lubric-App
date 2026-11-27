/**
 * Dashboard as worker1 — the second "Permission denied" (2026-11-24, live
 * api log): opening the Dashboard 403s on the duePayables query, which reads
 * vendor_payables JOIN vendors and needs purchase.manage | reports — two
 * keys worker1 does not hold.
 *
 * worker1 holds exactly [dashboard, customers, pos.create, sales_history].
 *
 * The fix, in src/modules/dashboard/Dashboard.tsx: the payables query only
 * runs when the signed-in user has purchase.manage or reports (the existing
 * can()/useAuth check), and the card hides otherwise. Every OTHER dashboard
 * query must pass for a dashboard holder — this sim runs them all through
 * the REAL requiredPermissions extracted from server/index.js (same
 * technique as sim_vps_port.js / sim_sale_permissions.js) and expects no
 * 403, with the payables query the one exception the gate excludes.
 *
 * Run:  node --experimental-strip-types sim_dashboard_permissions.js
 */

import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../src/modules/dashboard/Dashboard.tsx', import.meta.url), 'utf8');
const REMINDERS = readFileSync(new URL('../src/lib/reminders.ts', import.meta.url), 'utf8');

// ── extract the REAL permission machinery from server/index.js ─────────────
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in server/index.js`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(`could not match braces for ${name}`);
  return src.slice(start, i + 1);
}
const permSrc = SRC.slice(SRC.indexOf('const P = {'), SRC.indexOf('const permCache'));
const requiredPermissions = new Function(
  permSrc + '\n' + extractFunction(SRC, 'requiredPermissions') + '\nreturn requiredPermissions;'
)();

let ok = 0, total = 0, failed = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { failed++; console.log(`FAIL - ${title}: ${e.message}`); }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// The /api/query middleware's rule: a read passes when it needs nothing, or
// when one of its keys is held.
function allowed(sql, perms) {
  const need = requiredPermissions(sql);
  return need === null || need.some((p) => perms.includes(p));
}

const WORKER1 = ['dashboard', 'customers', 'pos.create', 'sales_history'];

// REMINDER_SELECT, extracted verbatim from src/lib/reminders.ts (the
// notification-centre query joins reminders to customers/vendors/vehicles).
const reminderSelect = (() => {
  const start = REMINDERS.indexOf('export const REMINDER_SELECT = `');
  assert(start !== -1, 'REMINDER_SELECT not found in reminders.ts');
  const bodyStart = REMINDERS.indexOf('`', start) + 1;
  const bodyEnd = REMINDERS.indexOf('`;', bodyStart);
  assert(bodyEnd !== -1, 'REMINDER_SELECT terminator not found');
  return REMINDERS.slice(bodyStart, bodyEnd);
})();

// ── every Dashboard.tsx query, verbatim ────────────────────────────────────
const DASHBOARD_QUERIES = {
  todaySales:
    "SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count FROM orders WHERE status = 'completed' AND created_at::date = CURRENT_DATE",
  weekSales:
    "SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count FROM orders WHERE status = 'completed' AND created_at >= now() - interval '7 days'",
  lowStock:
    'SELECT id, name, stock_qty, low_stock_threshold FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold LIMIT 8',
  recentOrders:
    "SELECT o.id, o.total, COALESCE(c.name, 'Walking Customer') as customer_name, o.created_at, o.status FROM orders o LEFT JOIN customers c ON o.customer_id = c.id ORDER BY o.id DESC LIMIT 8",
  counts:
    "SELECT (SELECT COUNT(*) FROM products WHERE active = 1) as products, (SELECT COUNT(*) FROM customers) as customers, (SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE AND status = 'completed') as orders_today, (SELECT COUNT(*) FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold) as low_stock",
  trendRows:
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              to_char(d.day, 'Dy') AS label,
              COALESCE(SUM(o.total), 0) AS revenue,
              COUNT(o.id) AS orders
       FROM orders o
       RIGHT JOIN generate_series(CURRENT_DATE - interval '6 days', CURRENT_DATE, interval '1 day') AS d(day)
         ON o.created_at::date = d.day::date AND o.status = 'completed'
       GROUP BY d.day
       ORDER BY d.day`,
  costRows:
    `SELECT to_char(o.created_at, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(oi.qty * COALESCE(p.cost_price, 0)), 0) AS cost
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id AND oi.kind = 'product'
       LEFT JOIN products p ON p.id = oi.ref_id
       WHERE o.status = 'completed' AND o.created_at >= CURRENT_DATE - interval '6 days'
       GROUP BY 1 ORDER BY 1`,
  brandMix:
    `SELECT COALESCE(b.name, 'Unbranded') AS name, SUM(oi.line_total) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.status = 'completed'
       LEFT JOIN products p ON p.id = oi.ref_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE oi.kind = 'product' AND o.created_at >= CURRENT_DATE - interval '30 days'
       GROUP BY 1 ORDER BY revenue DESC LIMIT 8`,
  categoryMix:
    `SELECT COALESCE(c.name, 'Uncategorised') AS name, SUM(oi.line_total) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.status = 'completed'
       LEFT JOIN products p ON p.id = oi.ref_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE oi.kind = 'product' AND o.created_at >= CURRENT_DATE - interval '30 days'
       GROUP BY 1 ORDER BY revenue DESC LIMIT 8`,
  topProducts:
    `SELECT oi.product_name AS name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.status = 'completed'
       WHERE oi.kind = 'product' AND o.created_at >= CURRENT_DATE - interval '30 days'
       GROUP BY 1 ORDER BY revenue DESC LIMIT 8`,
  notifs:
    `${reminderSelect}
         WHERE r.status = 'pending'
         ORDER BY CASE WHEN r.due_at IS NULL THEN 1 ELSE 0 END, r.due_at ASC NULLS LAST
         LIMIT 50`,
  lapsedCustomers:
    `SELECT id, name, phone, last_visit_at,
           EXTRACT(day FROM now() - NULLIF(last_visit_at, '')::timestamptz)::int AS days
         FROM customers
         WHERE phone <> ''
           AND last_visit_at IS NOT NULL
           AND NULLIF(last_visit_at, '')::timestamptz < now() - interval '60 days'
         ORDER BY last_visit_at ASC
         LIMIT 5`,
  fieldToday:
    `SELECT COALESCE(SUM(amount), 0) AS collected, COUNT(*) AS rows
           FROM cash_movements
          WHERE kind = 'collection' AND occurred_at::date = CURRENT_DATE`,
  fieldSummary:
    `SELECT COALESCE(SUM(CASE WHEN kind = 'collection' THEN amount ELSE 0 END), 0) AS collected,
                COALESCE(SUM(CASE WHEN kind = 'handover'   THEN amount ELSE 0 END), 0) AS handed_over,
                COUNT(*) AS rows
           FROM cash_movements
          WHERE occurred_at >= now() - interval '7 days'`,
  // The reminder action: a CTE that updates one reminder and re-inserts it
  // when it recurs. Classified as a read by requiredPermissions (starts
  // with WITH) and gated on the reminders table.
  actReminder:
    `WITH d AS (UPDATE reminders SET status=$2, completed_at=now(), updated_at=now() WHERE id=$1 RETURNING *)
       INSERT INTO reminders (shop_id, kind, title, details, due_at, due_km, last_mileage,
         customer_id, vehicle_id, vendor_id, order_id, priority, recurrence_days, created_by_user_id)
       SELECT shop_id, kind, title, details, due_at + (recurrence_days || ' days')::interval,
         due_km, last_mileage, customer_id, vehicle_id, vendor_id, order_id, priority,
         recurrence_days, created_by_user_id
       FROM d WHERE $2 = 'done' AND recurrence_days IS NOT NULL`,
};

// The one query the gate excludes — kept apart so the "every query passes"
// check below stays honest about what it covers.
const DUE_PAYABLES = `SELECT vp.id, vd.name AS vendor_name, vp.amount, vp.due_date
         FROM vendor_payables vp JOIN vendors vd ON vd.id = vp.vendor_id
         WHERE vp.status = 'pending'
           AND vp.due_date IS NOT NULL AND vp.due_date <> ''
           AND vp.due_date::timestamptz < now() + interval '7 days'
         ORDER BY vp.due_date ASC
         LIMIT 5`;

check('every dashboard query except payables passes for worker1', () => {
  const denied = Object.entries(DASHBOARD_QUERIES).filter(([, sql]) => !allowed(sql, WORKER1));
  assert(
    denied.length === 0,
    'denied queries: ' + denied.map(([name]) => name).join(', ')
  );
});

check('the payables query really does need khata | purchase.manage | reports', () => {
  assert(!allowed(DUE_PAYABLES, WORKER1), 'payables query must be denied for worker1');
  assert(
    JSON.stringify(requiredPermissions(DUE_PAYABLES).sort()) ===
      JSON.stringify(['khata', 'purchase.manage', 'reports'].sort()),
    'payables must need exactly khata | purchase.manage | reports, got ' +
      JSON.stringify(requiredPermissions(DUE_PAYABLES))
  );
  assert(allowed(DUE_PAYABLES, ['purchase.manage']), 'a purchase manager must see payables');
  assert(allowed(DUE_PAYABLES, ['reports']), 'a reports holder must see payables');
  // Batch 15: the khata page reads vendor payables too, so a khata holder
  // must see them — that is why khata joined the set, and worker1 (no
  // khata, no purchase.manage, no reports) is still denied.
  assert(allowed(DUE_PAYABLES, ['khata']), 'a khata holder must see payables');
});

check('Dashboard gates the payables query on those keys and hides the card', () => {
  assert(
    DASH.includes('can(user, "purchase.manage")') && DASH.includes('can(user, "reports")'),
    'no can() check for purchase.manage / reports in Dashboard.tsx'
  );
  assert(
    DASH.includes('enabled: canSeePayables'),
    'payables query has no enabled gate in Dashboard.tsx'
  );
  // The card only renders when the query returned rows; a disabled query
  // yields undefined, so the card stays hidden for a cashier.
  assert(
    DASH.includes('(duePayables?.length ?? 0) > 0'),
    'payables card is not conditional on the query result'
  );
});

console.log(`\n${ok}/${total} checks passed${failed ? ` — ${failed} FAILED` : ''}`);
if (failed) process.exit(1);
