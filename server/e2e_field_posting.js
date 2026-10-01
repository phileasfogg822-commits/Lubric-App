/**
 * Does a collection taken on a phone actually reach the shop's books?
 *
 * The test for what was missing: collections were stored and then sat in their
 * own table, invisible to the cash account, the customer's Khata and the
 * customer balance. `party_ledger` has carried a `cash_movement_id` column
 * since migration 014 to link them; nothing ever did.
 *
 * Creates its own customer and reverses every balance it touches, so the
 * shop's real money is left exactly as it was found.
 *
 * Run:  node e2e_field_posting.js
 *       API_BASE=http://localhost:3001
 */

import { randomUUID } from 'node:crypto';

const BASE = process.env.API_BASE || 'http://localhost:3001';
const AMOUNT = 4321;
const HANDOVER = 1500;

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
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}
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
async function auth(email, pass) {
  const { status, body } = await post('/api/auth/login', { email, password: pass });
  if (status !== 200) throw new Error('auth failed: ' + status);
  return body.token;
}

console.log('\nField collections post into the shop books');

const atok = await auth('admin@lubric.app', 'admin123');
const custName = 'e2e field customer ' + Math.floor(Math.random() * 100000);
const custUuid = randomUUID();
let deviceId = null, token = null, cmUuid = null, hoUuid = null;

const [account] = await q(
  "SELECT id, balance FROM accounts WHERE shop_id = 1 AND type = 'cash' AND active = 1 ORDER BY id LIMIT 1",
  [], atok);
assert(account, 'the shop needs an active cash account for this test');
const cashBefore = Number(account.balance);

await check('a customer with a known uuid exists to collect from', async () => {
  const r = await post('/api/execute', {
    sql: 'INSERT INTO customers (shop_id, name, phone, customer_type, credit_balance, uuid) ' +
         'VALUES (1, $1, $2, $3, $4, $5) RETURNING id',
    // One parameter per type: reusing $2 for both phone and balance makes
    // Postgres deduce inconsistent types and refuse the whole statement.
    params: [custName, '0300' + Math.floor(Math.random() * 9000000 + 1000000), 'returning', AMOUNT * 2, custUuid],
  }, atok);
  assert(r.status === 200, 'could not create the test customer: ' + JSON.stringify(r.body));
});

await check('pair a phone to collect with', async () => {
  const code = 'FIE' + Math.floor(1000 + Math.random() * 9000) + 'AA';
  const created = await post('/api/execute', {
    sql: 'INSERT INTO devices (shop_id, kind, name, pairing_code) VALUES (1, $1, $2, $3) RETURNING id',
    params: ['mobile', 'e2e field phone', code],
  }, atok);
  deviceId = Number(created.body.rows[0].id);
  const paired = await post('/api/v1/devices/pair', { code, name: 'e2e field phone' });
  assert(paired.status === 200, 'pairing failed');
  token = paired.body.token;
});

async function pushMovement(uuid, kind, amount) {
  return post('/api/v1/push', {
    changes: [{
      table: 'cash_movements', uuid, op: 'upsert',
      row: {
        uuid, kind, amount,
        customer_uuid: kind === 'collection' ? custUuid : '',
        customer_name: kind === 'collection' ? custName : '',
        note: 'e2e field posting',
        occurred_at: new Date().toISOString(),
        origin: 'mobile',
      },
    }],
  }, token);
}

await check('the collection is accepted', async () => {
  cmUuid = randomUUID();
  const res = await pushMovement(cmUuid, 'collection', AMOUNT);
  assert(res.status === 200, 'push failed');
  assert(res.body.applied?.length === 1, 'not applied: ' + JSON.stringify(res.body));
});

await check("it appears in the customer's Khata as a payment", async () => {
  const rows = await q(
    'SELECT kind, direction, amount, cash_movement_id FROM party_ledger WHERE uuid = $1',
    ['cm-' + cmUuid], atok);
  assert(rows.length === 1, 'no ledger row - the collection never reached the Khata');
  assert(rows[0].kind === 'payment', 'kind is ' + rows[0].kind);
  assert(rows[0].direction === 'credit', 'direction is ' + rows[0].direction + ', expected credit');
  assert(Number(rows[0].amount) === AMOUNT, 'amount is ' + rows[0].amount);
  assert(rows[0].cash_movement_id != null,
    'cash_movement_id is null - the ledger row is not linked to the collection');
});

await check("the customer's balance falls by the amount collected", async () => {
  const rows = await q('SELECT credit_balance FROM customers WHERE uuid = $1', [custUuid], atok);
  const expected = AMOUNT * 2 - AMOUNT;
  assert(Number(rows[0].credit_balance) === expected,
    'credit_balance is ' + rows[0].credit_balance + ', expected ' + expected);
});

await check("the shop's cash account receives the money", async () => {
  const rows = await q('SELECT balance FROM accounts WHERE id = $1', [account.id], atok);
  assert(Number(rows[0].balance) === cashBefore + AMOUNT,
    'cash is ' + rows[0].balance + ', expected ' + (cashBefore + AMOUNT));
  const txns = await q(
    'SELECT amount, type FROM account_transactions WHERE reference = $1',
    ['Field collection ' + cmUuid.slice(0, 8)], atok);
  assert(txns.length === 1, 'expected one account transaction, got ' + txns.length);
  assert(Number(txns[0].amount) === AMOUNT && txns[0].type === 'in',
    'transaction is ' + JSON.stringify(txns[0]));
});

await check('a retried push does NOT count the money twice', async () => {
  const res = await pushMovement(cmUuid, 'collection', AMOUNT);
  assert(res.body.applied?.length === 1, 'the retry should still report applied');
  const rows = await q('SELECT balance FROM accounts WHERE id = $1', [account.id], atok);
  assert(Number(rows[0].balance) === cashBefore + AMOUNT,
    'a retry changed cash to ' + rows[0].balance + ' - DOUBLE COUNTED');
  const led = await q('SELECT count(*)::int AS c FROM party_ledger WHERE uuid = $1', ['cm-' + cmUuid], atok);
  assert(led[0].c === 1, 'a retry added a second ledger row');
});

await check('a handover does not add the same money again', async () => {
  hoUuid = randomUUID();
  const res = await pushMovement(hoUuid, 'handover', HANDOVER);
  assert(res.body.applied?.length === 1, 'handover not accepted');
  const rows = await q('SELECT balance FROM accounts WHERE id = $1', [account.id], atok);
  assert(Number(rows[0].balance) === cashBefore + AMOUNT,
    'cash became ' + rows[0].balance + ' - the handover was counted a second time');
  const led = await q('SELECT count(*)::int AS c FROM party_ledger WHERE uuid = $1', ['cm-' + hoUuid], atok);
  assert(led[0].c === 0, 'a handover must not post to a customer ledger');
});

await check('cleanup - every balance is put back', async () => {
  if (cmUuid) {
    await post('/api/execute', {
      sql: 'DELETE FROM party_ledger WHERE uuid = $1', params: ['cm-' + cmUuid],
    }, atok);
    await post('/api/execute', {
      sql: 'UPDATE customers SET credit_balance = credit_balance + $1 WHERE uuid = $2',
      params: [AMOUNT, custUuid],
    }, atok);
    await post('/api/execute', {
      sql: 'DELETE FROM account_transactions WHERE reference = $1',
      params: ['Field collection ' + cmUuid.slice(0, 8)],
    }, atok);
    await post('/api/execute', {
      sql: 'UPDATE accounts SET balance = balance - $1 WHERE id = $2', params: [AMOUNT, account.id],
    }, atok);
    await post('/api/execute', { sql: 'DELETE FROM cash_movements WHERE uuid = $1', params: [cmUuid] }, atok);
  }
  if (hoUuid) {
    await post('/api/execute', { sql: 'DELETE FROM cash_movements WHERE uuid = $1', params: [hoUuid] }, atok);
  }
  if (deviceId) {
    await post('/api/execute', { sql: 'DELETE FROM devices WHERE id = $1', params: [deviceId] }, atok);
  }
  await post('/api/execute', { sql: 'DELETE FROM customers WHERE uuid = $1', params: [custUuid] }, atok);

  const [after] = await q('SELECT balance FROM accounts WHERE id = $1', [account.id], atok);
  assert(Number(after.balance) === cashBefore,
    'cash is ' + after.balance + ', should be back to ' + cashBefore);
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);