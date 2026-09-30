/**
 * Runs the khata against a real SQLite database — the offline desktop path
 * (src/lib/localDb.ts), the other half of the dual-mode data layer.
 *
 * The app sends PostgreSQL-flavoured SQL and relies on pgToSqlite() to
 * translate it, so every query in src/lib/ledgerSql.ts has to survive that
 * translation. This proves it does, using the app's OWN schema and its OWN
 * translation function rather than a hand-written SQLite copy that could drift.
 *
 * Run:  node --experimental-strip-types e2e_ledger_sqlite.js
 */

import { DatabaseSync } from 'node:sqlite';
import { ensureLocalSchema, pgToSqlite } from '../src/lib/localDb.ts';
import {
  allocatePayables,
  balanceQuery,
  billStatements,
  monthlyQuery,
  openPayablesQuery,
  partyBalancesQuery,
  paymentStatements,
  statementQuery,
} from '../src/lib/ledgerSql.ts';

const raw = new DatabaseSync(':memory:');

// Adapt node:sqlite to the tauri-plugin-sql interface the app's data layer
// uses, so the schema is created by the app's OWN ensureLocalSchema() —
// including the runtime column patching that an already-created local database
// needs. Building the tables by hand here would skip exactly the code most
// likely to be wrong.
const db = {
  execute: async (sql) => raw.exec(sql),
  select: async (sql) => raw.prepare(sql).all(),
};

/**
 * The desktop driver runs every statement through pgToSqlite() first — the
 * harness does that too. It also rewrites $1/$2 to ?, which is a property of
 * THIS harness only: node:sqlite binds anonymous placeholders, while the
 * Tauri plugin the app actually ships with (sqlx) understands $1. Without this
 * the test would fail on a difference that never affects the product.
 */
function toSqlite(sql) {
  return pgToSqlite(sql).replace(/\$(\d+)/g, '?');
}

function run(sql, params = []) {
  return raw.prepare(toSqlite(sql)).all(...params);
}
function exec(sql, params = []) {
  return raw.prepare(toSqlite(sql)).run(...params);
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
function near(a, b, m) {
  assert(Math.abs(Number(a) - Number(b)) < 0.01, (m || 'values differ') + `: got ${a}, want ${b}`);
}

// The schema is created by the app's own bootstrap, not re-declared here.
await ensureLocalSchema(db);
raw.exec(pgToSqlite("INSERT OR IGNORE INTO accounts (id, name, type) VALUES (1, 'Shop Cash Drawer', 'cash');"));

const TEST_UUID = '11111111-1111-4111-8111-111111111111';

console.log('\nOffline SQLite path (real localDb schema + pgToSqlite)');

check('the khata tables exist in the local schema', () => {
  const tables = run(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('party_ledger','commitments','payable_allocations')"
  ).map((r) => r.name);
  assert(tables.length === 3, 'expected 3 tables, got ' + tables.join(','));
});

check('the sync columns are patched onto a pre-existing local table', () => {
  // A desktop install that created its database before the khata existed has a
  // vendor_payables table WITHOUT these columns, and a payment that settles an
  // invoice updates updated_at. If the patch does not run, the payment fails
  // offline with "no such column: updated_at" — money that cannot be recorded.
  const cols = run('PRAGMA table_info(vendor_payables)').map((c) => c.name);
  for (const needed of ['uuid', 'shop_id', 'updated_at']) {
    assert(cols.includes(needed), 'vendor_payables is missing ' + needed + ' (has: ' + cols.join(',') + ')');
  }
});

check('the CHECK constraints are enforced offline like on the server', () => {
  const insert = (type, direction, uuid) =>
    `INSERT INTO party_ledger (uuid, party_type, party_id, kind, direction, amount)
     VALUES ('${uuid}', '${type}', 1, 'bill', '${direction}', 100)`;

  let threw = false;
  try {
    exec(insert('supplier', 'debit', 'bad-uuid'));
  } catch {
    threw = true;
  }
  assert(threw, 'an invalid party_type must be rejected by SQLite too');

  threw = false;
  try {
    exec(insert('customer', 'sideways', TEST_UUID));
  } catch {
    threw = true;
  }
  assert(threw, 'an invalid direction must be rejected by SQLite too');
});

check('a bill posts and raises the balance', () => {
  exec("INSERT INTO customers (id, name, phone, credit_balance) VALUES (1, 'Ali', '0300', 0)");
  for (const s of billStatements({
    uuid: 'a1', partyType: 'customer', partyId: 1, partyName: 'Ali',
    amount: 7500, note: 'goods', occurredAt: '2026-09-01',
  })) {
    exec(s.sql, s.params);
  }
  near(run(balanceQuery('customer', 1).sql, ['customer', 1])[0].balance, 7500, 'ledger balance');
  near(run('SELECT credit_balance FROM customers WHERE id = 1')[0].credit_balance, 7500, 'credit_balance');
});

check('the statement query returns a running balance on SQLite', () => {
  const rows = run(statementQuery('customer', 1).sql, ['customer', 1]);
  assert(rows.length === 1, 'expected 1 row, got ' + rows.length);
  near(rows[0].running, 7500, 'running balance');
  assert(rows[0].direction === 'debit', 'direction');
});

check('date_trunc is translated: the month bucket groups correctly', () => {
  const rows = run(monthlyQuery('customer', 1, 6).sql, ['customer', 1, 6]);
  assert(rows.length === 1, 'expected 1 bucket, got ' + rows.length);
  assert(String(rows[0].month).slice(0, 7) === '2026-09',
    'the bill must land in the 2026-09 bucket, got ' + rows[0].month);
  near(rows[0].billed, 7500, 'billed in the month');
  near(rows[0].settled, 0, 'nothing settled');
  near(rows[0].entries, 1, 'entry count');
});

check('a payment settles the balance and moves the cash account', () => {
  for (const s of paymentStatements({
    uuid: 'a2', partyType: 'customer', partyId: 1, partyName: 'Ali',
    amount: 2500, accountId: 1, note: 'cash', occurredAt: '2026-09-15', settle: [],
  })) {
    exec(s.sql, s.params);
  }
  near(run(balanceQuery('customer', 1).sql, ['customer', 1])[0].balance, 5000, 'ledger balance');
  near(run('SELECT balance FROM accounts WHERE id = 1')[0].balance, 2500, 'cash balance');
  const tx = run('SELECT type FROM account_transactions WHERE reference = $1', ['cash'])[0];
  assert(tx && tx.type === 'in', 'payment from a customer is money in');
});

check('the period filter works on SQLite', () => {
  const rows = run(statementQuery('customer', 1, { from: '2026-10-01' }).sql, ['customer', 1, '2026-10-01']);
  assert(rows.length === 0, 'September rows must not appear in October, got ' + rows.length);
});

check('the party list reports the same balance', () => {
  const rows = run(partyBalancesQuery('customer').sql, []);
  assert(rows.length === 1, 'expected 1 party, got ' + rows.length);
  near(rows[0].balance, 5000, 'balance in the party list');
});

check('a vendor purchase splits correctly across two invoices offline', () => {
  exec("INSERT INTO vendors (id, name, payable_balance) VALUES (1, 'Shell', 0)");
  for (const [amount, due] of [[3000, '2026-09-05'], [4000, '2026-09-25']]) {
    for (const s of billStatements({
      uuid: 'v' + amount, partyType: 'vendor', partyId: 1, partyName: 'Shell',
      amount, note: 'purchase', occurredAt: due, dueDate: due,
    })) {
      exec(s.sql, s.params);
    }
  }
  const open = run(openPayablesQuery(1).sql, [1]);
  assert(open.length === 2, 'two open payables, got ' + open.length);
  near(open[0].amount, 3000, 'oldest invoice first');
  near(open[0].settled, 0, 'nothing settled yet');

  const settle = allocatePayables(
    open.map((r) => ({ id: Number(r.id), amount: Number(r.amount), settled: Number(r.settled) })),
    5000
  );
  for (const s of paymentStatements({
    uuid: 'vp', partyType: 'vendor', partyId: 1, partyName: 'Shell',
    amount: 5000, accountId: 1, note: 'paid', occurredAt: '2026-09-28', settle,
  })) {
    exec(s.sql, s.params);
  }

  const after = run('SELECT id, status FROM vendor_payables WHERE vendor_id = 1 ORDER BY id');
  assert(after[0].status === 'paid', 'oldest invoice paid, got ' + after[0].status);
  assert(after[1].status === 'partial', 'second invoice partial, got ' + after[1].status);
  near(run(balanceQuery('vendor', 1).sql, ['vendor', 1])[0].balance, 2000, 'supplier balance left');

  const allocs = run(
    'SELECT vendor_payable_id, amount FROM payable_allocations WHERE payment_uuid = $1', ['vp']
  );
  assert(allocs.length === 2, 'the payment must record how it split, got ' + allocs.length);
  near(allocs.reduce((s, a) => s + a.amount, 0), 5000, 'allocations must total the payment');
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
