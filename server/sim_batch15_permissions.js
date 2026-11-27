/**
 * Batch 15 permissions — dashboard gate, khata as its own module, and the
 * add-only splits for customers and expenses (Umar, 2026-11-28):
 *
 *   1. The dashboard was visible to a cashier even with the option off:
 *      the sidebar hid the link, but the /dashboard route had no gate and
 *      every redirect in the app pointed at it. It is gated now, and a
 *      denial lands on the member's first allowed page, never /dashboard.
 *   2. The khata was not a separate module — it opened on either party
 *      key — so it could never be switched off per member. It is its own
 *      `khata` key now, on the Team checklist, the route, and the sidebar.
 *   3. Non-admin accounts may ADD a customer / an expense but may not
 *      view the list, edit, or delete: `customers.add` / `expenses.add`.
 *      The split is enforced at the statement level in the server
 *      classifier — INSERT only — so the add key cannot UPDATE or DELETE
 *      through the SQL endpoint either.
 *
 * This sim runs the REAL requiredPermissions extracted from
 * server/index.js (same technique as sim_dashboard_permissions.js) plus
 * source-anchored checks on the route wiring, so a regression that
 * re-opens any of the three gaps fails here.
 *
 * Run:  node --experimental-strip-types server/sim_batch15_permissions.js
 */

import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const LAYOUT = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8');
const PERMS = readFileSync(new URL('../src/lib/permissions.ts', import.meta.url), 'utf8');
const EXPENSES = readFileSync(new URL('../src/modules/expenses/Expenses.tsx', import.meta.url), 'utf8');
const CUSTOMERS = readFileSync(new URL('../src/modules/customers/Customers.tsx', import.meta.url), 'utf8');
const POS = readFileSync(new URL('../src/modules/pos/POS.tsx', import.meta.url), 'utf8');
const TEAM = readFileSync(new URL('../src/modules/team/Team.tsx', import.meta.url), 'utf8');

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
  try { fn(); ok++; console.log(`  PASS ${title}`); }
  catch (e) { failed++; console.log(`  FAIL ${title}: ${e.message}`); }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// The /api/query middleware's rule: a read passes when it needs nothing, or
// when one of its keys is held. Writes use the same rule via the middleware.
function allowed(sql, perms) {
  const need = requiredPermissions(sql);
  return need === null || need.some((p) => perms.includes(p));
}

const CASHIER_NEW = ['dashboard', 'pos.create', 'sales_history', 'customers.add', 'expenses.add'];
const CASHIER_NO_DASH = ['pos.create', 'sales_history', 'customers.add', 'expenses.add'];
const ADD_ONLY = ['customers.add', 'expenses.add'];

console.log('\nDashboard gate — the route and the redirects');
check('/dashboard and /reminders are wrapped in RequirePermission dashboard', () => {
  assert(
    APP.includes('<Route path="/dashboard" element={<RequirePermission permission="dashboard">'),
    '/dashboard has no RequirePermission wrapper'
  );
  assert(
    APP.includes('<Route path="/reminders" element={<RequirePermission permission="dashboard">'),
    '/reminders has no RequirePermission wrapper'
  );
});
check('no redirect in App.tsx points at /dashboard any more', () => {
  const hits = [...APP.matchAll(/to="\/dashboard"/g)];
  assert(hits.length === 0, `${hits.length} redirect(s) still point at /dashboard`);
});
check('/ and * land via LandingRedirect, and login redirects to the landing', () => {
  assert(APP.includes('<Route path="/" element={<LandingRedirect />} />'), '/ does not use LandingRedirect');
  assert(APP.includes('<Route path="*" element={<LandingRedirect />} />'), '* does not use LandingRedirect');
  assert(APP.includes('firstAllowedRoute(user, enabled)'), 'RedirectIfAuth does not use firstAllowedRoute');
  assert(PERMS.includes('export function firstAllowedRoute('), 'firstAllowedRoute missing from permissions.ts');
});
check('a dashboard-less cashier is denied nothing on the till, but the dashboard itself', () => {
  // The gate is the route wrapper, not the classifier: the dashboard's
  // own queries still pass for a dashboard holder (proven by
  // sim_dashboard_permissions.js), and nothing here re-opens the page.
  assert(!CASHIER_NO_DASH.includes('dashboard'), 'fixture error: cashier must not hold dashboard');
  assert(allowed("SELECT id FROM customers ORDER BY name", CASHIER_NO_DASH), 'till customer pick must pass');
  assert(allowed("SELECT id, name FROM accounts WHERE active = 1 ORDER BY name", CASHIER_NO_DASH), 'till account pick must pass');
});

console.log('\nKhata as its own module');
check('khata key exists in the client and the server with the same string', () => {
  assert(PERMS.includes('KHATA: "khata"'), 'client KHATA key missing');
  assert(SRC.includes("KHATA: 'khata'"), 'server KHATA key missing');
  assert(PERMS.includes('{ key: PERMISSIONS.KHATA, label: "Khata"'), 'khata missing from the Team checklist');
});
check('/ledger is gated on khata alone, and the sidebar follows it', () => {
  assert(APP.includes('<Route path="/ledger" element={<RequirePermission permission="khata">'), '/ledger is not gated on khata alone');
  assert(!APP.includes('anyOf={["customers", "vendors"]}'), 'the old customers/vendors khata gate is still there');
  assert(LAYOUT.includes('{ to: "/ledger", label: "Khata", icon: "\\u{1F4D8}", permission: "khata" }'), 'sidebar Khata entry is not gated on khata');
});
check('a khata holder reads and posts the ledger; the old party keys still work', () => {
  const read = "SELECT * FROM party_ledger WHERE party_id = $1";
  const write = "INSERT INTO party_ledger (party_type, party_id, amount) VALUES ($1,$2,$3)";
  assert(allowed(read, ['khata']), 'khata holder must read party_ledger');
  assert(allowed(write, ['khata']), 'khata holder must post party_ledger');
  assert(allowed(read, ['customers']), 'customers overlap must keep reading the ledger');
  assert(allowed(write, ['customers']), 'customers overlap must keep posting the ledger');
  assert(allowed("SELECT * FROM vendor_payables WHERE vendor_id = $1", ['khata']), 'khata holder must read vendor_payables');
});
check('cashier and worker defaults do not hold khata', () => {
  assert(!CASHIER_NEW.includes('khata'), 'cashier default must NOT hold khata');
  // Worker default is asserted in unit_permissions_batch15.js; here the
  // classifier only proves the key exists and is not implied by the till.
  assert(!allowed("SELECT * FROM party_ledger WHERE party_id = $1", ADD_ONLY), 'add-only keys must not read the ledger');
});

console.log('\nCustomers split — add without view / edit / remove');
check('customers.add inserts a customer but cannot update or delete one', () => {
  const ins = "INSERT INTO customers (name, phone, customer_type, credit_balance) VALUES ($1, $2, $3, 0) RETURNING id";
  const upd = "UPDATE customers SET customer_type = 'returning' WHERE id = $1";
  const del = "DELETE FROM customers WHERE id = $1";
  assert(allowed(ins, ['customers.add']), 'customers.add must INSERT');
  assert(!allowed(upd, ['customers.add']), 'customers.add must NOT UPDATE');
  assert(!allowed(del, ['customers.add']), 'customers.add must NOT DELETE');
  assert(allowed(ins, ['customers']), 'customers key must still INSERT');
  assert(allowed(upd, ['customers']), 'customers key must still UPDATE');
});
check('the till customer pick still works for a cashier without the list', () => {
  const pick = "SELECT id, name, phone, customer_type, credit_balance, last_visit_at FROM customers ORDER BY name";
  assert(allowed(pick, CASHIER_NEW), 'cashier pick must pass via pos.create');
  assert(allowed(pick, ['pos.create']), 'pos.create alone must read customers');
});
check('POS gates the add button on customers.add and the promote action on customers', () => {
  assert(POS.includes('can(user, PERMISSIONS.CUSTOMER_ADD)'), 'POS add-customer is not gated on customers.add');
  assert(POS.includes('addCustomerFromTill'), 'POS has no add-customer flow');
  assert(POS.includes('can(user, PERMISSIONS.CUSTOMERS)'), 'POS promote-to-returning is not gated on customers');
});
check('Customers page hides Edit without the list key and logs the view', () => {
  assert(CUSTOMERS.includes('canManage && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>Edit</button>'), 'Edit button is not gated on the list key');
  assert(CUSTOMERS.includes('logAction(user, "view", "customers")'), 'Customers view is not logged');
  assert(CUSTOMERS.includes('logAction(user, editId ? "edit" : "add", "customer"'), 'Customer add/edit is not logged');
});

console.log('\nExpenses split — add without view / delete');
check('expenses.add inserts an expense but cannot update or delete one', () => {
  const ins = "INSERT INTO expenses (shop_id, category, subcategory, amount, account_id, date, note) VALUES ($1,$2,$3,$4,$5,$6,$7)";
  const upd = "UPDATE expenses SET amount=$1 WHERE id=$2";
  const del = "DELETE FROM expenses WHERE id = $1";
  assert(allowed(ins, ['expenses.add']), 'expenses.add must INSERT');
  assert(!allowed(upd, ['expenses.add']), 'expenses.add must NOT UPDATE');
  assert(!allowed(del, ['expenses.add']), 'expenses.add must NOT DELETE');
  assert(allowed(ins, ['expenses.manage']), 'expenses.manage must still INSERT');
  assert(allowed(del, ['expenses.manage']), 'expenses.manage must still DELETE');
});
check('the expense save side-effects ride on the add key too', () => {
  assert(allowed("UPDATE accounts SET balance = balance - $1 WHERE id = $2", ['expenses.add']), 'add key must move the till balance');
  assert(allowed("INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'out',$3)", ['expenses.add']), 'add key must write the ledger row');
});
check('the records query never runs for an add-only member', () => {
  assert(EXPENSES.includes('enabled: canManage,'), 'expenses list query has no manage-only enabled gate');
  assert(EXPENSES.includes('(canManage || canAdd)'), 'Add Expense button is not open to the add key');
  assert(EXPENSES.includes('logAction(user, "view", "expenses")'), 'expenses view is not logged');
  assert(EXPENSES.includes('logAction(user, "delete", "expense"'), 'expense delete is not logged');
});
check('/expenses opens on either key and the sidebar follows', () => {
  assert(APP.includes('<Route path="/expenses" element={<RequirePermission anyOf={["expenses.manage", "expenses.add"]}>'), '/expenses route is not open to both keys');
  assert(LAYOUT.includes('anyOf: ["expenses.manage", "expenses.add"]'), 'sidebar Expenses entry is not open to both keys');
});

console.log('\nTeam page offers the add-only keys as their own group');
check('Team renders the ADD_PERMISSIONS group', () => {
  assert(TEAM.includes('ADD_PERMISSIONS,'), 'Team does not import ADD_PERMISSIONS');
  assert(TEAM.includes('title="What they can add without opening the page"'), 'Team has no add-only permission group');
});

console.log(`\n${ok}/${total} checks passed${failed ? ` — ${failed} FAILED` : ''}`);
if (failed) process.exit(1);
