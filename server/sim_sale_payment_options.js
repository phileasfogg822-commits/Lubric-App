/**
 * Till payment options — pay in full, in part, or later, by cash, EasyPaisa
 * or bank transfer (Umar, 2026-11-25 ~23:28 PKT, on the Windows app).
 *
 * Report: "there is no pay later option, partial pay option, (easy paisa,
 * bank transfer, cash) radio buttons as well to keep the record. it should
 * be small, so its not prominent."
 *
 * Before this batch completeSale always recorded a FULL cash payment: the
 * orders INSERT hardcoded paid_amount = total and payment_method = 'cash',
 * and the whole total was credited to the till account — even when the
 * customer had paid nothing. The orders table already had paid_amount,
 * payment_method and status (server 008_reporting.sql, local schema), and
 * Reports already derives what is owed as total - paid_amount, but the sale
 * flow never used any of it. The Khata ledger (014) already models a sale
 * as a bill (debit, full total) plus a payment (credit, what was collected)
 * — its backfill writes exactly that pair for old orders — but a new till
 * sale posted no ledger rows at all, so a customer's Khata never saw it.
 *
 * Fix (src/modules/pos/POSCart.tsx, src/lib/payment.ts, src/lib/ledgerSql.ts):
 *  - completeSale takes an optional payment { method, choice, amountPaid }.
 *    Full pays the total, partial pays the entered amount, later pays 0;
 *    the order row records paid_amount and payment_method ('pay_later'
 *    when nothing arrived), status stays 'completed' — the sale happened —
 *    and the due is total - paid_amount, as Reports already reads it.
 *  - Only the money actually collected credits the till account, with an
 *    account_transactions 'in' row for the same amount.
 *  - A customer sale posts the 014 pair to party_ledger, linked to the
 *    order: bill (debit, full total) + payment (credit, paid now, only
 *    when something was paid). The net move of credit_balance is the due.
 *    A walk-in has no Khata, so no rows. The payment helper is called
 *    with accountId null, so the ledger payment cannot credit the till a
 *    second time — the sale's own account block already did that.
 *  - The rules live once in lib/payment.ts (validatePayment) and both the
 *    sale and the POS header call them: partial and later need a customer
 *    and a partial amount strictly between 0 and the total.
 *  - The POS header gains two small radio groups at the tier-button scale
 *    (Cash / EasyPaisa / Bank, Full / Partial / Later) plus a small amount
 *    input for partial; the receipt shows Paid / Due only when they differ.
 *  - The local schema gains the server's idx_ledger_order_kind unique
 *    index (014) — one bill and one payment row per order — so a retried
 *    sale cannot book the same receivable twice.
 *
 * The gap that let the old behaviour ship: every earlier sale sim models a
 * full-cash sale and embeds the old orders INSERT as text; no sim ever ran
 * a partial or pay-later sale. This sim does, with the REAL pgToSqlite,
 * the REAL orders INSERT extracted from source, and the REAL ledger
 * helpers — and it fails on the old code (see the red-before note in the
 * report) because the old INSERT stores paid = total and 'cash' whatever
 * the operator chose.
 *
 * Out of scope here (flagged for a follow-up): paying off a due later —
 * there is no till action that collects against an old order yet, so a due
 * can only be settled from the Khata payment screen; and edit/void of a
 * partial sale — editSale can already change paid_amount, but it does not
 * adjust the ledger rows this batch posts, and voidOrder does not reverse
 * them either.
 *
 * Run:  node --experimental-strip-types server/sim_sale_payment_options.js
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
import { billStatements, paymentStatements } from '../src/lib/ledgerSql.ts';
import {
  resolvePaidNow,
  resolvePaymentMethod,
  todayLocal,
  validatePayment,
} from '../src/lib/payment.ts';

// ── sqlx-faithful binding (copied from sim_sale_service_reminder.js) ────
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
const LEDGERSQL = readFileSync(new URL('../src/lib/ledgerSql.ts', import.meta.url), 'utf8');
const POS = readFileSync(new URL('../src/modules/pos/POS.tsx', import.meta.url), 'utf8');
const POSPRINT = readFileSync(new URL('../src/modules/pos/POSPrint.tsx', import.meta.url), 'utf8');
const LOCALDB = readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');

// The REAL orders INSERT, extracted from POSCart.tsx — not a copy. The
// payment surface is what this sim proves, so the row that carries
// paid_amount and payment_method must be the source's own text.
function ordersInsertFromSource() {
  const start = POSCART.indexOf('`INSERT INTO orders (id, shop_id');
  assert(start >= 0, 'POSCart.tsx must contain the orders INSERT');
  const end = POSCART.indexOf('`,', start);
  assert(end > start, 'the orders INSERT literal must close');
  return POSCART.slice(start + 1, end);
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

console.log('\nTill payment options: full / partial / later, cash / EasyPaisa / bank transfer');

// ── Part 1 — wiring: the source carries the new shape ───────────────────
check('WIRING: the orders INSERT records paid now and the method as parameters', () => {
  const src = ordersInsertFromSource();
  assert(src.includes('VALUES ($1, 1, $2, $3, $4, $5, $6, $7,'),
    'the INSERT must take paid_amount as $5 and payment_method as $7, got: ' + src);
  assert(!src.includes("'cash'"), 'the INSERT must not hardcode cash, got: ' + src);
  assert(!/\\$4, \\$4/.test(src), 'paid_amount must not copy the total, got: ' + src);
  assert(src.includes("'completed'"), 'the sale must still complete, got: ' + src);
});

check('WIRING: the ledger helpers carry the order id', () => {
  assert(LEDGERSQL.includes('orderId?: number | null'), 'BillInput/PaymentInput must accept orderId');
  assert(LEDGERSQL.includes('origin, order_id)'), 'the ledger INSERTs must list order_id');
  assert(LEDGERSQL.includes('i.orderId ?? null'), 'the order id must ride the params');
});

check('WIRING: POSCart posts the Khata pair for a customer sale', () => {
  assert(POSCART.includes('billStatements({'), 'completeSale must post the bill');
  assert(POSCART.includes('paymentStatements({'), 'completeSale must post the collection');
  assert(POSCART.includes('accountId: null,'), 'the ledger payment must not move the till twice');
  assert(POSCART.includes('validatePayment(total, payChoice,'), 'completeSale must validate first');
});

check('WIRING: the POS header has the small radios and calls the same rules', () => {
  assert(POS.includes('payMethod') && POS.includes('payChoice') && POS.includes('partialAmount'),
    'POS.tsx must hold the payment state');
  assert(POS.includes('validatePayment(total, payChoice, amountPaid, customerId != null)'),
    'the header must validate with the same function as completeSale');
  assert(POS.includes('{ method: payMethod, choice: payChoice, amountPaid }'),
    'the header must pass the choice through to completeSale');
  assert(POS.includes('Pick a customer first'), 'partial/later must explain why they are disabled');
  assert(POS.includes('Paid now'), 'partial must ask for the amount paid now');
});

check('WIRING: the receipt shows Paid / Due only when they differ', () => {
  assert(POSPRINT.includes('showSplit'), 'POSPrint must gate the split lines');
  assert(POSPRINT.includes('Paid ('), 'the receipt must show what was paid');
  assert(POSPRINT.includes('Due:'), 'the receipt must show what is owed');
  assert(POSPRINT.includes('PAYMENT_METHOD_LABELS[paymentMethod]'), 'the method label must ride the Paid line');
});

check('WIRING: the local schema carries the one-bill-one-payment index', () => {
  assert(LOCALDB.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_order_kind ON party_ledger(order_id, kind) WHERE order_id IS NOT NULL'),
    'localDb.ts must mirror the server 014 unique index');
});

check('SQL: the new statements translate with no cast left and stay valid Postgres', () => {
  const orders = pgToSqlite(ordersInsertFromSource());
  assert(!orders.includes('::'), 'translated orders INSERT must have no cast, got: ' + orders);
  assert(ordersInsertFromSource().includes('NOW()'), 'the source must keep NOW() for Postgres');
  const bill = billStatements({ uuid: 'u1', partyType: 'customer', partyId: 1, partyName: '', amount: 4000, note: 'Bill #1', occurredAt: '2026-11-25', orderId: 1 });
  const pay = paymentStatements({ uuid: 'u2', partyType: 'customer', partyId: 1, partyName: '', amount: 1500, accountId: null, note: 'Collected at till - bill #1', occurredAt: '2026-11-25', settle: [], orderId: 1 });
  for (const s of [...bill, ...pay]) {
    const t = pgToSqlite(s.sql);
    assert(!t.includes('::'), 'translated ledger statement must have no cast, got: ' + t);
    assert(!/to_char|generate_series|interval/i.test(s.sql), 'no Postgres-only construct may appear, got: ' + s.sql);
  }
  assert(bill[0].params[6] === 1, 'the bill must carry the order id as its last param, got: ' + JSON.stringify(bill[0].params));
  assert(pay[0].params[7] === 1, 'the payment must carry the order id as its last param, got: ' + JSON.stringify(pay[0].params));
});

// ── Part 2 — the database and the sale builder ──────────────────────────
// Mirrors completeSale's payment-relevant statements: the order row, the
// till credit for money collected, the customer touch, and the Khata pair.
// Item lines and stock movements are covered by the other sale sims.
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
h.raw.exec("INSERT INTO customers (id, shop_id, name, phone, customer_type) VALUES (1, 1, 'Ahmed Raza', '03001112222', 'returning')");
await ensureLocalSchema(h.db);

function saleStatements({ oid, customerId, userId, total, choice, method, amountPaid }) {
  const paidNow = resolvePaidNow(total, choice, amountPaid);
  const orderMethod = resolvePaymentMethod(choice, method);
  const err = validatePayment(total, choice, amountPaid, customerId != null);
  assert(!err, 'the sale builder must only build allowed sales, got: ' + err);
  const stmts = [
    { sql: ordersInsertFromSource(), params: [oid, customerId, userId, total, paidNow, 1, orderMethod, null, 0, ''] },
  ];
  if (paidNow > 0) {
    stmts.push({ sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [paidNow, 1] });
    stmts.push({ sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1, $2, 'in', $3)", params: [1, paidNow, `Order #${oid}`] });
  }
  if (customerId) {
    stmts.push({ sql: 'UPDATE customers SET last_visit_at = NOW() WHERE id = $1', params: [customerId] });
    stmts.push(...billStatements({ uuid: `bill-${oid}`, partyType: 'customer', partyId: customerId, partyName: '', amount: total, note: `Bill #${oid}`, occurredAt: todayLocal(), orderId: oid }));
    if (paidNow > 0) {
      stmts.push(...paymentStatements({ uuid: `pay-${oid}`, partyType: 'customer', partyId: customerId, partyName: '', amount: paidNow, accountId: null, note: `Collected at till - bill #${oid}`, occurredAt: todayLocal(), settle: [], orderId: oid }));
    }
  }
  return stmts;
}

const balance = () => Number(h.run('SELECT balance FROM accounts WHERE id = 1')[0].balance);
const txCount = () => Number(h.run("SELECT COUNT(*) AS c FROM account_transactions")[0].c);
const ledger = (oid) => h.run('SELECT kind, direction, amount, note, order_id FROM party_ledger WHERE order_id = $1 ORDER BY id', [oid]);
const creditBalance = () => Number(h.run('SELECT credit_balance FROM customers WHERE id = 1')[0].credit_balance);
const order = (oid) => h.run('SELECT total, paid_amount, payment_method, status FROM orders WHERE id = $1', [oid])[0];

// ── Part 3 — full cash sale to a customer: the old behaviour, unchanged ─
check('FULL: a full cash sale records paid = total, method cash, and nets zero in the Khata', () => {
  const before = balance();
  h.runTx(saleStatements({ oid: 1, customerId: 1, userId: 1, total: 4000, choice: 'full', method: 'cash', amountPaid: 0 }));
  const o = order(1);
  assert(Number(o.total) === 4000 && Number(o.paid_amount) === 4000, 'the order must record paid = total, got ' + JSON.stringify(o));
  assert(o.payment_method === 'cash' && o.status === 'completed', 'method cash, status completed, got ' + JSON.stringify(o));
  assert(balance() - before === 4000, 'the till must gain the whole total');
  assert(txCount() === 1, 'exactly one till receipt must exist');
  const rows = ledger(1);
  assert(rows.length === 2, 'bill + payment must both post, got ' + rows.length);
  assert(rows[0].kind === 'bill' && rows[0].direction === 'debit' && Number(rows[0].amount) === 4000 && rows[0].note === 'Bill #1',
    'the bill must be the full total, got ' + JSON.stringify(rows[0]));
  assert(rows[1].kind === 'payment' && rows[1].direction === 'credit' && Number(rows[1].amount) === 4000 && rows[1].note === 'Collected at till - bill #1',
    'the collection must match the bill, got ' + JSON.stringify(rows[1]));
  assert(creditBalance() === 0, 'a fully paid customer owes nothing, got ' + creditBalance());
});

// ── Part 4 — partial by EasyPaisa: only the paid part moves the till ────
check('PARTIAL: EasyPaisa 1500 of 4000 credits only 1500 and owes 2500', () => {
  const before = balance();
  const beforeTx = txCount();
  h.runTx(saleStatements({ oid: 2, customerId: 1, userId: 1, total: 4000, choice: 'partial', method: 'easypaisa', amountPaid: 1500 }));
  const o = order(2);
  assert(Number(o.paid_amount) === 1500, 'the order must record the part paid, got ' + JSON.stringify(o));
  assert(o.payment_method === 'easypaisa', 'the method must be easypaisa, got ' + JSON.stringify(o));
  assert(o.status === 'completed', 'a partial sale still completes, got ' + JSON.stringify(o));
  assert(balance() - before === 1500, 'the till must gain only the paid part');
  assert(txCount() - beforeTx === 1, 'exactly one till receipt for the part paid');
  const receipt = h.run("SELECT amount FROM account_transactions WHERE reference = 'Order #2'")[0];
  assert(Number(receipt.amount) === 1500, 'the receipt must be the part paid, got ' + JSON.stringify(receipt));
  const rows = ledger(2);
  assert(rows.length === 2, 'bill + payment must both post, got ' + rows.length);
  assert(Number(rows[0].amount) === 4000 && Number(rows[1].amount) === 1500,
    'the bill is the full total and the payment the part paid, got ' + JSON.stringify(rows));
  assert(creditBalance() === 2500, 'the customer must owe the remainder, got ' + creditBalance());
});

// ── Part 5 — pay later: nothing moves the till, the whole total is owed ─
check('LATER: a pay-later sale moves no money and owes the whole total', () => {
  const before = balance();
  const beforeTx = txCount();
  h.runTx(saleStatements({ oid: 3, customerId: 1, userId: 1, total: 4000, choice: 'later', method: 'cash', amountPaid: 0 }));
  const o = order(3);
  assert(Number(o.paid_amount) === 0, 'the order must record nothing paid, got ' + JSON.stringify(o));
  assert(o.payment_method === 'pay_later', 'the method must say pay_later, not cash, got ' + JSON.stringify(o));
  assert(balance() - before === 0, 'the till must not move');
  assert(txCount() - beforeTx === 0, 'no till receipt for money that never arrived');
  const rows = ledger(3);
  assert(rows.length === 1 && rows[0].kind === 'bill' && Number(rows[0].amount) === 4000,
    'only the bill posts, got ' + JSON.stringify(rows));
  assert(creditBalance() === 6500, 'the customer must owe 2500 + 4000, got ' + creditBalance());
});

// ── Part 6 — bank transfer in full ──────────────────────────────────────
check('BANK: a full bank-transfer sale records the method and pays in full', () => {
  h.runTx(saleStatements({ oid: 4, customerId: 1, userId: 1, total: 2500, choice: 'full', method: 'bank_transfer', amountPaid: 0 }));
  const o = order(4);
  assert(o.payment_method === 'bank_transfer' && Number(o.paid_amount) === 2500,
    'the method must be bank_transfer, got ' + JSON.stringify(o));
  assert(creditBalance() === 6500, 'a fully paid sale must not change what is owed, got ' + creditBalance());
});

// ── Part 7 — walk-in: full only, and no Khata rows ─────────────────────
check('WALK-IN: a full cash walk-in sale credits the till and posts no Khata rows', () => {
  const before = balance();
  h.runTx(saleStatements({ oid: 5, customerId: null, userId: 1, total: 1200, choice: 'full', method: 'cash', amountPaid: 0 }));
  const o = order(5);
  assert(Number(o.paid_amount) === 1200 && o.payment_method === 'cash', 'the walk-in sale must complete in full, got ' + JSON.stringify(o));
  assert(balance() - before === 1200, 'the till must gain the whole total');
  assert(ledger(5).length === 0, 'a walk-in has no Khata, so no ledger rows');
  assert(creditBalance() === 6500, 'walk-in sales must not touch the customer balance');
});

// ── Part 8 — the guards, through the real rules ─────────────────────────
check('GUARD: a walk-in cannot pay partial or later', () => {
  assert(validatePayment(4000, 'partial', 1500, false), 'walk-in partial must be refused');
  assert(validatePayment(4000, 'later', 0, false), 'walk-in later must be refused');
  assert(validatePayment(4000, 'full', 0, false) === null, 'walk-in full must stay allowed');
});

check('GUARD: a partial amount must sit strictly between 0 and the total', () => {
  for (const bad of [0, -50, 4000, 4001, NaN]) {
    assert(validatePayment(4000, 'partial', bad, true), 'partial of ' + bad + ' must be refused');
  }
  assert(validatePayment(4000, 'partial', 3999, true) === null, 'one rupee short of the total is a valid partial');
});

check('GUARD: the builder refuses a bad sale before any statement runs', () => {
  let err = null;
  try {
    saleStatements({ oid: 6, customerId: null, userId: 1, total: 4000, choice: 'later', method: 'cash', amountPaid: 0 });
  } catch (e) { err = e; }
  assert(err && /customer/i.test(err.message), 'the builder must throw for a walk-in later sale, got: ' + (err && err.message));
  assert(!h.run('SELECT id FROM orders WHERE id = 6')[0], 'no order row may exist for the refused sale');
});

// ── Part 9 — the ledger invariant ───────────────────────────────────────
check('INDEX: a second bill for the same order is rejected', () => {
  let err = null;
  try {
    h.runTx(billStatements({ uuid: 'bill-dup', partyType: 'customer', partyId: 1, partyName: '', amount: 4000, note: 'Bill #1', occurredAt: todayLocal(), orderId: 1 }));
  } catch (e) { err = e; }
  assert(err && /UNIQUE constraint failed/i.test(err.message),
    'the (order_id, kind) index must reject a duplicate bill, got: ' + (err && err.message));
  assert(ledger(1).length === 2, 'the duplicate must not have landed');
});

check('LEDGER: the statement balance equals the due Reports derives', () => {
  const fromLedger = Number(h.run("SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0) AS b FROM party_ledger WHERE party_type = 'customer' AND party_id = 1")[0].b);
  const fromOrders = Number(h.run("SELECT COALESCE(SUM(total - paid_amount), 0) AS b FROM orders WHERE customer_id = 1 AND status = 'completed'")[0].b);
  assert(fromLedger === 6500, 'the ledger balance must be 6500, got ' + fromLedger);
  assert(fromOrders === 6500, 'the orders-derived due must be 6500, got ' + fromOrders);
  assert(fromLedger === fromOrders, 'ledger and orders must agree on what is owed');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
