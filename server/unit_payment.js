/**
 * Unit tests for the till payment rules (src/lib/payment.ts) — pay in full,
 * in part, or later (Umar, 2026-11-25).
 *
 * No server needed — the rules are pure, which is the reason they live in
 * their own module instead of inside completeSale or the POS header: both
 * call sites must agree about what is allowed, and a pure function is the
 * one place that agreement lives.
 *
 * What is checked:
 *   1. full payment collects the total, for a walk-in or a customer alike
 *   2. partial collects the entered amount and needs a customer
 *   3. partial of 0, of the whole total, or of more than the total is refused
 *   4. later collects nothing, records 'pay_later', and needs a customer
 *   5. a walk-in can only pay in full
 *   6. a zero bill cannot be partial or later
 *   7. amounts are rounded to whole paisa
 *   8. today's date is the local YYYY-MM-DD the Khata takes
 *
 * Run:  node --experimental-strip-types unit_payment.js
 */

// Plain JavaScript on purpose: --experimental-strip-types only strips .ts
// modules, so a .js test cannot carry type annotations of its own even
// though it imports a .ts file.
import {
  PAYMENT_METHOD_LABELS,
  resolvePaidNow,
  resolvePaymentMethod,
  todayLocal,
  validatePayment,
} from '../src/lib/payment.ts';

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
const eq = (a, b, m) => assert(a === b, (m || 'value') + ': expected ' + b + ', got ' + a);

console.log('\nTill payment rules (full / partial / later)');

check('full payment collects the total, walk-in or customer', () => {
  eq(resolvePaidNow(4000, 'full', 0), 4000, 'full pays the total');
  eq(validatePayment(4000, 'full', 0, false), null, 'a walk-in may pay in full');
  eq(validatePayment(4000, 'full', 0, true), null, 'a customer may pay in full');
  eq(resolvePaymentMethod('full', 'bank_transfer'), 'bank_transfer', 'the chosen method is kept');
});

check('partial collects the entered amount and needs a customer', () => {
  eq(resolvePaidNow(4000, 'partial', 1500), 1500, 'partial pays the entered amount');
  eq(validatePayment(4000, 'partial', 1500, true), null, 'partial with a customer is allowed');
  eq(resolvePaymentMethod('partial', 'easypaisa'), 'easypaisa', 'the chosen method is kept');
});

check('partial without a customer is refused', () => {
  const err = validatePayment(4000, 'partial', 1500, false);
  assert(err && /customer/i.test(err), 'must ask for a customer, got: ' + err);
});

check('partial of 0, of the whole total, or of more is refused', () => {
  for (const bad of [0, -100, 4000, 5000, NaN]) {
    const err = validatePayment(4000, 'partial', bad, true);
    assert(err, 'partial of ' + bad + ' must be refused');
  }
  assert(/less than the total/i.test(validatePayment(4000, 'partial', 4000, true)),
    'paying the whole total must be called full, not partial');
  assert(/more than 0/i.test(validatePayment(4000, 'partial', 0, true)),
    'paying 0 must be called later, not partial');
});

check('later collects nothing, records pay_later, and needs a customer', () => {
  eq(resolvePaidNow(4000, 'later', 0), 0, 'later pays nothing now');
  eq(validatePayment(4000, 'later', 0, true), null, 'later with a customer is allowed');
  eq(resolvePaymentMethod('later', 'cash'), 'pay_later', 'a later sale records pay_later, not cash');
  const err = validatePayment(4000, 'later', 0, false);
  assert(err && /customer/i.test(err), 'a walk-in must not pay later, got: ' + err);
});

check('a zero bill cannot be partial or later', () => {
  assert(validatePayment(0, 'partial', 100, true), 'partial on a zero bill must be refused');
  assert(validatePayment(0, 'later', 0, true), 'later on a zero bill must be refused');
  eq(validatePayment(0, 'full', 0, false), null, 'a zero bill can still complete in full');
});

check('amounts round to whole paisa', () => {
  eq(resolvePaidNow(4000.5, 'full', 0), 4000.5, 'a half rupee survives');
  eq(resolvePaidNow(4000, 'partial', 1500.25), 1500.25, 'a quarter rupee survives');
  eq(resolvePaidNow(100, 'partial', 33.333), 33.33, 'a third of a hundred rounds down');
});

check('today is the local YYYY-MM-DD the Khata takes', () => {
  const d = new Date();
  const want = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  eq(todayLocal(), want, 'todayLocal');
});

check('method labels read as the shop says them', () => {
  eq(PAYMENT_METHOD_LABELS.cash, 'Cash', 'cash');
  eq(PAYMENT_METHOD_LABELS.easypaisa, 'EasyPaisa', 'easypaisa');
  eq(PAYMENT_METHOD_LABELS.bank_transfer, 'Bank transfer', 'bank_transfer');
  eq(PAYMENT_METHOD_LABELS.pay_later, 'Pay later', 'pay_later');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
