/**
 * Contract test for the field app's outbox payloads.
 *
 * Reads the SAME golden fixture as field_app/test/outbox_payload_test.dart
 * (test/fixtures/outbox_payloads.json) and pushes those bytes to the real
 * /api/v1/push. That is the whole point: the phone's encoder and the shop's
 * parser are asserted against one shared file, so the two halves of the sync
 * protocol cannot drift apart again.
 *
 * This is the check that was missing when the hand-rolled encoder shipped.
 * Every earlier test passed because the payloads were hand-written with proper
 * JSON - the phone's own encoder was never exercised end to end, and no
 * collection taken on a phone ever reached the shop while every test was green.
 *
 * Run:  node --experimental-strip-types e2e_payload.js
 *       API_BASE=http://localhost:3001
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.API_BASE || 'http://localhost:3001';
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'field_app', 'test', 'fixtures', 'outbox_payloads.json');

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

console.log('\nField app outbox payloads (shared with the Flutter tests)');

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const atok = await auth('admin@lubric.app', 'admin123');

await check('the fixture is present and versioned', () => {
  assert(fixture.movement && fixture.reservation, 'fixture lost its payload shapes');
  assert(fixture.broken_v1_payload, 'fixture lost the reproduction of the bug');
});

await check('the payload the OLD encoder produced really was invalid JSON', () => {
  let threw = false;
  try {
    JSON.parse(fixture.broken_v1_payload);
  } catch {
    threw = true;
  }
  assert(threw, 'the old failure no longer reproduces - the fixture is stale, '
    + 'so the golden test is no longer protecting anything');
});

let deviceId = null;
let token = null;

await check('pair a phone to test with', async () => {
  const code = 'E2E' + Math.floor(1000 + Math.random() * 9000) + 'AA';
  const created = await post('/api/execute', {
    sql: 'INSERT INTO devices (shop_id, kind, name, pairing_code) VALUES (1, $1, $2, $3) RETURNING id',
    params: ['mobile', 'e2e payload phone', code],
  }, atok);
  deviceId = Number(created.body.rows[0].id);
  const paired = await post('/api/v1/devices/pair', { code, name: 'e2e payload phone' });
  assert(paired.status === 200, 'pairing failed');
  token = paired.body.token;
});

await check('the shop accepts BOTH phone payload shapes unchanged', async () => {
  const changes = [
    { table: fixture.movement.table, uuid: fixture.movement.row.uuid, op: 'upsert', row: fixture.movement.row },
    { table: fixture.reservation.table, uuid: fixture.reservation.row.uuid, op: 'upsert', row: fixture.reservation.row },
  ];
  const res = await post('/api/v1/push', { changes }, token);
  assert(res.status === 200, 'push failed: ' + JSON.stringify(res.body).slice(0, 200));
  assert(res.body.applied?.length === 2,
    'expected 2 applied, got ' + JSON.stringify(res.body));
  assert(res.body.rejected?.length === 0,
    'rows rejected: ' + JSON.stringify(res.body.rejected));
});

await check('the collection landed with its values intact', async () => {
  const rows = await q(
    'SELECT amount, origin FROM cash_movements WHERE uuid = $1 AND shop_id = 1',
    [fixture.movement.row.uuid], atok);
  assert(rows.length === 1, 'the collection did not reach the shop');
  assert(Number(rows[0].amount) === 600,
    'amount came through as ' + rows[0].amount + ', expected 600');
  assert(rows[0].origin === 'mobile',
    'origin came through as ' + rows[0].origin + ', expected mobile');
});

await check('the reservation landed with its values intact', async () => {
  const rows = await q(
    'SELECT amount, status FROM reservations WHERE uuid = $1 AND shop_id = 1',
    [fixture.reservation.row.uuid], atok);
  assert(rows.length === 1, 'the reservation did not reach the shop');
  assert(Number(rows[0].amount) === 15000,
    'amount came through as ' + rows[0].amount + ', expected 15000');
  assert(rows[0].status === 'open',
    'status came through as ' + rows[0].status + ', expected open');
});

await check('a push is idempotent - a retry after a drop changes nothing', async () => {
  const changes = [
    { table: fixture.movement.table, uuid: fixture.movement.row.uuid, op: 'upsert', row: fixture.movement.row },
  ];
  const res = await post('/api/v1/push', { changes }, token);
  assert(res.status === 200, 're-push failed');
  const rows = await q('SELECT count(*)::int AS c FROM cash_movements WHERE uuid = $1',
    [fixture.movement.row.uuid], atok);
  assert(rows[0].c === 1, 'duplicate row created on retry: ' + rows[0].c);
});

await check('cleanup', async () => {
  if (deviceId) {
    await post('/api/execute', { sql: 'DELETE FROM devices WHERE id = $1', params: [deviceId] }, atok);
    await post('/api/execute', { sql: 'DELETE FROM cash_movements WHERE uuid = $1', params: [fixture.movement.row.uuid] }, atok);
    await post('/api/execute', { sql: 'DELETE FROM reservations WHERE uuid = $1', params: [fixture.reservation.row.uuid] }, atok);
  }
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
