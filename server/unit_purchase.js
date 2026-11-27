/**
 * Unit tests for the vendor invoice rules (src/lib/purchase.ts) — pure,
 * so they run here without a database. The database behaviour (stock
 * in, ledger, idempotency) is proven by server/sim_purchase_invoice_stock_in.js.
 *
 * Run:  node server/unit_purchase.js
 */

import {
  purchaseInvoiceTotal,
  purchaseLineTotal,
  validatePurchaseInvoice,
} from '../src/lib/purchase.ts';

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

const line = (over = {}) => ({ productId: 1, newName: '', qty: 10, unitCost: 250, ...over });
const input = (over = {}) => ({
  vendorId: 1,
  lines: [line()],
  paidNow: 0,
  accountId: null,
  notes: '',
  ...over,
});

console.log('\nVendor invoice rules');

check('TOTALS: line total is qty x unit cost, invoice total is the sum', () => {
  assert(purchaseLineTotal({ qty: 10, unitCost: 250 }) === 2500, '10 x 250 must be 2500');
  assert(purchaseLineTotal({ qty: 0.5, unitCost: 1000 }) === 500, '0.5 x 1000 must be 500');
  assert(purchaseInvoiceTotal([line(), line({ qty: 2, unitCost: 100 })]) === 2700,
    '2500 + 200 must be 2700');
});

check('VALID: a full invoice with one existing product passes', () => {
  assert(validatePurchaseInvoice(input()) === null, 'a plain invoice must pass');
});

check('VALID: a new-name line passes, and paid-in-full passes', () => {
  assert(validatePurchaseInvoice(input({ lines: [line({ productId: null, newName: 'Shell 20W-50' })] })) === null,
    'a new-name line must pass');
  assert(validatePurchaseInvoice(input({ paidNow: 2500, accountId: 1 })) === null,
    'paying the whole total now must pass');
});

check('GUARD: no vendor is refused', () => {
  assert(validatePurchaseInvoice(input({ vendorId: null })) === 'Pick a vendor first',
    'a missing vendor must be refused');
});

check('GUARD: no lines is refused', () => {
  assert(validatePurchaseInvoice(input({ lines: [] })) === 'Add at least one product',
    'an empty invoice must be refused');
});

check('GUARD: a line with neither product nor new name is refused', () => {
  assert(validatePurchaseInvoice(input({ lines: [line({ productId: null, newName: '  ' })] })) !== null,
    'a nameless line must be refused');
});

check('GUARD: zero or negative quantity is refused', () => {
  assert(validatePurchaseInvoice(input({ lines: [line({ qty: 0 })] })) !== null, 'qty 0 must be refused');
  assert(validatePurchaseInvoice(input({ lines: [line({ qty: -3 })] })) !== null, 'qty -3 must be refused');
});

check('GUARD: a negative cost price is refused', () => {
  assert(validatePurchaseInvoice(input({ lines: [line({ unitCost: -1 })] })) !== null,
    'a negative cost must be refused');
});

check('GUARD: paid now above the total is refused', () => {
  assert(validatePurchaseInvoice(input({ paidNow: 2501, accountId: 1 })) !== null,
    'overpaying the invoice must be refused');
  assert(validatePurchaseInvoice(input({ paidNow: -5 })) !== null, 'a negative payment must be refused');
});

check('GUARD: paying now without an account is refused', () => {
  assert(validatePurchaseInvoice(input({ paidNow: 1000, accountId: null })) !== null,
    'a payment with no account must be refused');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
