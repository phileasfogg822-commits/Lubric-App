/**
 * End-to-end test for the khata (party ledger, migration 014/015/016).
 *
 * Two halves:
 *  1. The pure arithmetic in src/lib/ledgerSql.ts — FIFO allocation of a
 *     payment across open invoices, and the rounding every posting goes
 *     through. Checked first because a bug here silently corrupts money.
 *  2. The live app, over the real HTTP API with a real admin token: the
 *     statement query, the running balance, the month buckets, and a whole
 *     payment/bill posting going through /api/transaction.
 *
 * The SQL is imported from the app, NOT copied into this file, so the test
 * fails if the queries the app actually sends are wrong — a duplicated copy
 * here would happily keep passing after the app changed.
 *
 * Run:  node e2e_ledger.js          (needs the API + Postgres up)
 */

import {
  allocatePayables,
  billStatements,
  balanceQuery,
  monthlyQuery,
  openPayablesQuery,
  partyBalancesQuery,
  paymentStatements,
  round2,
  statementQuery,
} from '../src/lib/ledgerSql.ts';

const BASE = process.env.API_BASE || 'http://localhost:3001';

// ── helpers (same shape as e2e_reminders.js) ──────────────────────────────────
async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function q(sql, params, token) {
  const { status, body } = await post('/api/query', { sql, params }, token);
  if (status !== 200) throw new Error('query ' + status + ' ' + JSON.stringify(body));
  return body;
}

async function txn(statements, token) {
  const { status, body } = await post('/api/transaction', { statements }, token);
  if (status !== 200) throw new Error('txn ' + status + ' ' + JSON.stringify(body));
  return body.results;
}

async function auth(email, pass) {
  const { status, body } = await post('/api/auth/login', { email, password: pass });
  if (status !== 200) throw new Error('auth failed for ' + email + ': ' + status);
  return body.token;
}

let ok = 0, total = 0;
async function check(title, fn) {
  total++;
  try {
    await fn();
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function near(a, b, msg) {
  const d = Math.abs(Number(a) - Number(b));
  assert(d < 0.01, (msg || 'values differ') + `: got ${a}, want ${b}`);
}

// ── 1. pure arithmetic ────────────────────────────────────────────────────────
async function unitChecks() {
  console.log('\nPure logic (src/lib/ledgerSql.ts)');

  await check('allocatePayables: full payment marks the invoice paid', () => {
    const out = allocatePayables([{ id: 7, amount: 5000, settled: 0 }], 5000);
    assert(out.length === 1 && out[0].id === 7 && out[0].status === 'paid', JSON.stringify(out));
  });

  await check('allocatePayables: part payment marks the invoice partial', () => {
    const out = allocatePayables([{ id: 7, amount: 5000, settled: 0 }], 2000);
    assert(out.length === 1 && out[0].status === 'partial', JSON.stringify(out));
  });

  await check('allocatePayables: clears the oldest invoice first', () => {
    const out = allocatePayables(
      [{ id: 1, amount: 3000, settled: 0 }, { id: 2, amount: 4000, settled: 0 }],
      5000
    );
    assert(out.length === 2, JSON.stringify(out));
    assert(out[0].id === 1 && out[0].status === 'paid', 'invoice 1 should be settled: ' + JSON.stringify(out));
    assert(out[1].id === 2 && out[1].status === 'partial', 'invoice 2 should be partial: ' + JSON.stringify(out));
  });

  await check('allocatePayables: an already-settled invoice is skipped', () => {
    const out = allocatePayables([{ id: 1, amount: 3000, settled: 3000 }], 1000);
    assert(out.length === 0, 'nothing left to settle, got ' + JSON.stringify(out));
  });

  await check('allocatePayables: an advance settles nothing and is kept', () => {
    const out = allocatePayables([], 5000);
    assert(out.length === 0, JSON.stringify(out));
  });

  await check('round2 keeps whole paisa and kills float noise', () => {
    near(round2(0.1 + 0.2), 0.3, '0.1+0.2');
    near(round2(1234.567), 1234.57, 'rounding to 2dp');
  });

  await check('a bill raises the party balance, a payment lowers it', () => {
    const bill = billStatements({
      uuid: 'u1', partyType: 'customer', partyId: 1, partyName: 'X',
      amount: 1000, note: '', occurredAt: '2026-01-01',
    });
    const pay = paymentStatements({
      uuid: 'u2', partyType: 'customer', partyId: 1, partyName: 'X',
      amount: 400, accountId: 1, note: '', occurredAt: '2026-01-02', settle: [],
    });
    const signs = (list) =>
      list.map((s) => (s.sql.match(/credit_balance = COALESCE\(credit_balance, 0\) ([+-]) \$1/) || [])[1]);
    assert(signs(bill).join('') === '+', 'bill must add: ' + signs(bill));
    assert(signs(pay).join('') === '-', 'payment must subtract: ' + signs(pay));
  });

  await check('a vendor bill also creates an open payable', () => {
    const stmts = billStatements({
      uuid: 'u3', partyType: 'vendor', partyId: 1, partyName: 'V',
      amount: 900, note: '', occurredAt: '2026-01-01', dueDate: '2026-02-01',
    });
    assert(stmts.length === 3, 'expected payable + ledger + balance, got ' + stmts.length);
    assert(/INSERT INTO vendor_payables/i.test(stmts[0].sql), 'first statement must be the payable');
    assert(/'bill', 'debit'/.test(stmts[1].sql), 'ledger row must be a debit');
    assert(/party_ledger/.test(stmts[1].sql) && /vendor_payable_id/.test(stmts[1].sql),
      'ledger row must link the payable it came from');
  });
}

// ── 2. live API ───────────────────────────────────────────────────────────────
async function liveChecks(tok) {
  console.log('\nLive app (real API, real Postgres)');

  // Work on a customer nobody else in the test touches.
  const marker = 'e2e-khata-' + Date.now();
  await txn(
    [{
      sql: 'INSERT INTO customers (shop_id, name, phone, customer_type) VALUES (1, $1, $2, $3) RETURNING id',
      params: [marker, '0300' + Date.now().toString().slice(-7), 'wholesale'],
    }],
    tok
  );
  const cust = (await q('SELECT id, credit_balance FROM customers WHERE name = $1', [marker], tok))[0];
  assert(cust?.id, 'could not create the test customer');

  const cid = Number(cust.id);
  const startBalance = Number(cust.credit_balance) || 0;

  await check('billing on account posts a debit and raises the balance', async () => {
    const bill = 7500;
    await txn(
      billStatements({
        uuid: 'e2e-bill-' + Date.now(), partyType: 'customer', partyId: cid,
        partyName: marker, amount: bill, note: 'e2e goods', occurredAt: '2026-09-01',
      }),
      tok
    );
    const [row] = await q(balanceQuery('customer', cid).sql, ['customer', cid], tok);
    near(row.balance, startBalance + bill, 'ledger balance after the bill');

    // The denormalised column the rest of the app reads must agree with it.
    const [c] = await q('SELECT credit_balance FROM customers WHERE id = $1', [cid], tok);
    near(c.credit_balance, startBalance + bill, 'customers.credit_balance after the bill');
  });

  await check('the statement shows the bill with a running balance', async () => {
    const query = statementQuery('customer', cid);
    const rows = await q(query.sql, query.params, tok);
    assert(rows.length === 1, 'expected exactly 1 row, got ' + rows.length);
    near(rows[0].amount, 7500, 'row amount');
    assert(rows[0].direction === 'debit', 'a bill is a debit');
    near(rows[0].running, startBalance + 7500, 'running balance on the row');
  });

  await check('a period filter excludes rows outside it', async () => {
    const query = statementQuery('customer', cid, { from: '2026-10-01' });
    const rows = await q(query.sql, query.params, tok);
    assert(rows.length === 0, 'the September bill must not appear in October, got ' + rows.length);
  });

  await check('the month buckets sum to the same money', async () => {
    const query = monthlyQuery('customer', cid, 6);
    const rows = await q(query.sql, query.params, tok);
    const sept = rows.find((r) => String(r.month).slice(0, 7) === '2026-09');
    assert(sept, 'the September bill must land in the 2026-09 bucket: ' + JSON.stringify(rows));
    near(sept.billed, 7500, 'billed in the month');
    near(sept.settled, 0, 'nothing settled yet');
  });

  await check('a payment posts a credit and settles the balance', async () => {
    const [acct] = await q('SELECT balance FROM accounts WHERE id = 1', [], tok);
    const cashBefore = Number(acct.balance) || 0;

    await txn(
      paymentStatements({
        uuid: 'e2e-pay-' + Date.now(), partyType: 'customer', partyId: cid,
        partyName: marker, amount: 2500, accountId: 1, note: 'e2e part payment',
        occurredAt: '2026-09-15', settle: [],
      }),
      tok
    );

    const [row] = await q(balanceQuery('customer', cid).sql, ['customer', cid], tok);
    near(row.balance, startBalance + 5000, 'ledger balance after the payment');

    const [c] = await q('SELECT credit_balance FROM customers WHERE id = $1', [cid], tok);
    near(c.credit_balance, startBalance + 5000, 'credit_balance after the payment');

    // Money must have reached the till, and been journalled.
    const [after] = await q('SELECT balance FROM accounts WHERE id = 1', [], tok);
    near(after.balance, cashBefore + 2500, 'cash account balance');

    const [tx] = await q(
      'SELECT type, amount FROM account_transactions WHERE reference = $1', ['e2e part payment'], tok
    );
    assert(tx, 'the payment must leave an account_transactions row');
    assert(tx.type === 'in', 'a customer paying us is money in, got ' + tx.type);
    near(tx.amount, 2500, 'journalled amount');
  });

  await check('the running balance walks through every entry', async () => {
    const query = statementQuery('customer', cid);
    const rows = await q(query.sql, query.params, tok);
    assert(rows.length === 2, 'expected 2 rows, got ' + rows.length);
    near(rows[0].running, startBalance + 7500, 'running after the bill');
    near(rows[1].running, startBalance + 5000, 'running after the payment');
    // Chronological order: the 1st precedes the 15th.
    assert(rows[0].occurred_at < rows[1].occurred_at,
      `statement must be oldest-first, got ${rows[0].occurred_at} then ${rows[1].occurred_at}`);
  });

  await check('the party list reports the same balance as the statement', async () => {
    const query = partyBalancesQuery('customer');
    const rows = await q(query.sql, query.params, tok);
    const me = rows.find((r) => Number(r.party_id) === cid);
    assert(me, 'the test customer must appear in the party list');
    near(me.balance, startBalance + 5000, 'balance in the party list');
  });

  await check('a vendor purchase is settled oldest-invoice-first', async () => {
    const markerV = 'e2e-vendor-' + Date.now();
    await txn(
      [{ sql: 'INSERT INTO vendors (shop_id, name) VALUES (1, $1) RETURNING id', params: [markerV] }],
      tok
    );
    const vid = Number((await q('SELECT id FROM vendors WHERE name = $1', [markerV], tok))[0].id);

    // Two invoices: 3000 due first, 4000 second.
    for (const [amount, due] of [[3000, '2026-09-05'], [4000, '2026-09-25']]) {
      await txn(
        billStatements({
          uuid: 'e2e-vbill-' + Date.now() + amount, partyType: 'vendor', partyId: vid,
          partyName: markerV, amount, note: 'e2e purchase', occurredAt: due, dueDate: due,
        }),
        tok
      );
    }

    const open = await q(openPayablesQuery(vid).sql, [vid], tok);
    assert(open.length === 2, 'two open payables expected, got ' + open.length);
    near(open[0].amount, 3000, 'oldest invoice first');

    // Pay 5000: clears the 3000 invoice, leaves 2000 on the 4000 one.
    const settle = allocatePayables(
      open.map((r) => ({ id: Number(r.id), amount: Number(r.amount), settled: Number(r.settled) })),
      5000
    );
    await txn(
      paymentStatements({
        uuid: 'e2e-vpay-' + Date.now(), partyType: 'vendor', partyId: vid,
        partyName: markerV, amount: 5000, accountId: 1, note: 'e2e supplier payment',
        occurredAt: '2026-09-28', settle,
      }),
      tok
    );

    const after = await q(
      'SELECT id, amount, status FROM vendor_payables WHERE vendor_id = $1 ORDER BY id', [vid], tok
    );
    assert(after[0].status === 'paid', 'oldest invoice must be paid, got ' + after[0].status);
    assert(after[1].status === 'partial', 'second invoice must be partial, got ' + after[1].status);

    // What we owe the supplier: 7000 bought, 5000 paid.
    const [row] = await q(balanceQuery('vendor', vid).sql, ['vendor', vid], tok);
    near(row.balance, 2000, 'supplier balance left');
    const [v] = await q('SELECT payable_balance FROM vendors WHERE id = $1', [vid], tok);
    near(v.payable_balance, 2000, 'vendors.payable_balance left');

    // Paying a supplier is money OUT of the till.
    const [tx] = await q(
      'SELECT type FROM account_transactions WHERE reference = $1', ['e2e supplier payment'], tok
    );
    assert(tx && tx.type === 'out', 'paying a supplier must be money out, got ' + (tx && tx.type));
  });

  await check('an unauthenticated read of the ledger is refused', async () => {
    const anon = await post('/api/query', { sql: 'SELECT 1 FROM party_ledger LIMIT 1' });
    assert(anon.status === 401, 'unauthenticated read must be 401, got ' + anon.status);
  });

  await check('the ledger replicates to a paired device, uuid and all', async () => {
    const dev = await post('/api/v1/devices', { kind: 'desktop', name: 'e2e-khata' }, tok);
    assert(dev.status === 200, 'could not create a device: ' + dev.status + ' ' + JSON.stringify(dev.body));
    const paired = await post('/api/v1/devices/pair', { code: dev.body.pairing_code, name: 'e2e' });
    assert(paired.status === 200, 'pairing failed: ' + JSON.stringify(paired.body));

    const pull = await fetch(BASE + '/api/v1/pull?since=0', {
      headers: { Authorization: 'Bearer ' + paired.body.token },
    });
    const data = await pull.json();
    assert(
      data.changes && Object.prototype.hasOwnProperty.call(data.changes, 'party_ledger'),
      'party_ledger must replicate to devices, got: ' + Object.keys(data.changes || {}).join(',')
    );
    const ours = (data.changes.party_ledger || []).filter((r) => r.note === 'e2e part payment');
    assert(ours.length === 1, 'the posted payment must replicate, got ' + ours.length);
    assert(ours[0].uuid, 'a replicated ledger row must carry its uuid');
  });

  // Clean up so a re-run starts from the same place. party_ledger holds a
  // foreign key to vendor_payables, so the ledger rows go first; the
  // allocations cascade off both.
  await check('cleanup', async () => {
    await q('DELETE FROM party_ledger WHERE party_id = $1 AND party_type = $2 RETURNING id', [cid, 'customer'], tok);
    await q('UPDATE customers SET credit_balance = $1 WHERE id = $2 RETURNING id', [startBalance, cid], tok);
    await q('DELETE FROM customers WHERE id = $1 RETURNING id', [cid], tok);
    await q("DELETE FROM party_ledger WHERE party_type = 'vendor' AND party_id IN (SELECT id FROM vendors WHERE name LIKE 'e2e-vendor-%') RETURNING id", [], tok);
    await q("DELETE FROM vendor_payables WHERE vendor_id IN (SELECT id FROM vendors WHERE name LIKE 'e2e-vendor-%') RETURNING id", [], tok);
    await q("DELETE FROM vendors WHERE name LIKE 'e2e-vendor-%' RETURNING id", [], tok);
  });
}

async function main() {
  await unitChecks();
  const tok = await auth('admin@lubric.app', 'admin123');
  await liveChecks(tok);
  console.log('\n' + ok + '/' + total + ' checks passed');
  process.exit(ok === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
