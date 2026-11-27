/**
 * Unit tests for the batch-15 permission rules (src/lib/permissions.ts) —
 * pure, so they run here without a database. The server-side enforcement
 * (requiredPermissions) and the route wiring are proven by
 * server/sim_batch15_permissions.js.
 *
 * Run:  node server/unit_permissions_batch15.js
 */

import {
  ADD_PERMISSIONS,
  ALL_PERMISSIONS,
  MODULE_PERMISSIONS,
  PERMISSIONS,
  firstAllowedRoute,
  getDefaultPermissions,
  parsePermissions,
} from '../src/lib/permissions.ts';

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log('  PASS ' + title); }
  catch (e) { console.log('  FAIL ' + title + ': ' + e.message); }
}
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}
function assertEq(a, b, m) {
  assert(JSON.stringify(a) === JSON.stringify(b), (m || '') + ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

const user = (role, perms) => ({ role, permissions: JSON.stringify(perms) });
const cashierNoDash = user('cashier', ['pos.create', 'sales_history', 'customers.add', 'expenses.add']);
const cashierFull = user('cashier', ['dashboard', 'pos.create', 'sales_history', 'customers.add', 'expenses.add']);
const khataOnly = user('cashier', ['khata']);
const addOnly = user('cashier', ['customers.add']);
const nothing = user('cashier', []);
const admin = user('admin', []);

console.log('\nLanding — first allowed page');
check('cashier without dashboard lands on POS, never the dashboard', () => {
  assertEq(firstAllowedRoute(cashierNoDash), '/pos');
});
check('cashier with dashboard lands on the dashboard', () => {
  assertEq(firstAllowedRoute(cashierFull), '/dashboard');
});
check('khata-only member lands on the khata', () => {
  assertEq(firstAllowedRoute(khataOnly), '/ledger');
});
check('add-only member holds no page key, lands on the version page', () => {
  assertEq(firstAllowedRoute(addOnly), '/version');
});
check('member with no permissions at all lands on the version page', () => {
  assertEq(firstAllowedRoute(nothing), '/version');
});
check('no user lands on the login page', () => {
  assertEq(firstAllowedRoute(null), '/login');
  assertEq(firstAllowedRoute(undefined), '/login');
});
check('admin lands on the dashboard', () => {
  assertEq(firstAllowedRoute(admin), '/dashboard');
});
check('a module the deployment does not include is never a landing spot', () => {
  const enabled = (k) => k !== 'dashboard' && k !== 'pos.create';
  assertEq(firstAllowedRoute(cashierFull, enabled), '/sales');
});
check('admin with every module disabled still lands somewhere safe', () => {
  assertEq(firstAllowedRoute(admin, () => false), '/version');
});
check('expenses.add alone opens the expenses page as a landing spot', () => {
  assertEq(firstAllowedRoute(user('cashier', ['expenses.add'])), '/expenses');
});

console.log('\nDefaults — who holds what');
check('cashier default has the add keys and no khata, no customer list', () => {
  const d = getDefaultPermissions('cashier');
  assert(d.includes('customers.add'), 'cashier must have customers.add');
  assert(d.includes('expenses.add'), 'cashier must have expenses.add');
  assert(!d.includes('khata'), 'cashier must NOT have khata');
  assert(!d.includes('customers'), 'cashier must NOT have the customer list');
  assert(!d.includes('expenses.manage'), 'cashier must NOT have expenses.manage');
});
check('worker default mirrors the cashier split plus inspections', () => {
  const d = getDefaultPermissions('worker');
  assert(d.includes('customers.add') && d.includes('expenses.add'), 'worker must have both add keys');
  assert(d.includes('inspections'), 'worker must keep inspections');
  assert(!d.includes('khata') && !d.includes('customers'), 'worker must NOT have khata or the customer list');
});
check('accountant keeps the money side and gains khata', () => {
  const d = getDefaultPermissions('accountant');
  assert(d.includes('khata'), 'accountant must have khata');
  assert(d.includes('customers.add'), 'accountant must have customers.add');
  assert(d.includes('expenses.manage'), 'accountant must keep expenses.manage');
});
check('manager keeps everything except team/shop/bill.delete', () => {
  const d = getDefaultPermissions('manager');
  assert(d.includes('khata'), 'manager must have khata');
  assert(d.includes('customers.add') && d.includes('expenses.add'), 'manager must have both add keys');
  assert(!d.includes('team.manage') && !d.includes('shop.manage'), 'manager must NOT have team/shop');
});

console.log('\nChecklist shape');
check('khata is a module key in the Team checklist', () => {
  assert(MODULE_PERMISSIONS.some((p) => p.key === PERMISSIONS.KHATA), 'khata missing from MODULE_PERMISSIONS');
});
check('the add keys live in their own group, not in the module list', () => {
  assert(ADD_PERMISSIONS.some((p) => p.key === 'customers.add'), 'customers.add missing from ADD_PERMISSIONS');
  assert(ADD_PERMISSIONS.some((p) => p.key === 'expenses.add'), 'expenses.add missing from ADD_PERMISSIONS');
  assert(!MODULE_PERMISSIONS.some((p) => p.key === 'customers.add'), 'customers.add must NOT be a module key');
  assert(!MODULE_PERMISSIONS.some((p) => p.key === 'expenses.add'), 'expenses.add must NOT be a module key');
});
check('admin defaults still cover every key', () => {
  const all = ALL_PERMISSIONS.map((p) => p.key).sort();
  const d = [...getDefaultPermissions('admin')].sort();
  assertEq(d, all);
});
check('parsePermissions still handles the TEXT-column JSON', () => {
  assertEq(parsePermissions('["dashboard","khata"]'), ['dashboard', 'khata']);
});

console.log(`\n${ok}/${total} checks passed`);
if (ok !== total) process.exit(1);
