/**
 * End-to-end test for device pairing - the codes used to attach a phone.
 *
 * Covers the whole path, because a break in any part leaves a shop owner unable
 * to add a phone with no obvious error:
 *   1. the code shape the shop types (8 uppercase hex, same as pair.js),
 *   2. the permission guard on the devices table,
 *   3. minting a code, spending it, and the code being single-use,
 *   4. revoking a device, and a revoked device being unable to pair.
 *
 * The guard is the important one. A device token can read and write the whole
 * shop over /v1, so a pairing code is a permanent credential in waiting. The
 * devices table was missing from the server's permission map, and because an
 * unlisted table is ALLOWED by default, any logged-in cashier could mint
 * themselves a code and trade it for a full-access token.
 *
 * Run:  node --experimental-strip-types e2e_pairing.js
 */

import { newPairingCode } from '../src/lib/uuid.ts';

const BASE = process.env.API_BASE || 'http://localhost:3001';

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
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}

console.log('\nPairing codes and the device permission guard');

await check('a generated code is 8 uppercase hex characters', () => {
  for (let i = 0; i < 200; i++) {
    const code = newPairingCode();
    assert(/^[0-9A-F]{8}$/.test(code), 'bad code shape: ' + code);
  }
});

await check('generated codes do not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(newPairingCode());
  // 2000 draws from 2^32; a birthday collision is plausible at a few percent, so
  // allow a couple - but a constant count would mean the generator is broken.
  assert(seen.size > 1990, 'only ' + seen.size + ' distinct codes out of 2000');
});

const atok = await auth('admin@lubric.app', 'admin123');
let ctok = null;
try {
  ctok = await auth('cashier@lubric.app', 'cashier123');
} catch (e) {
  console.log('  (no cashier user - skipping the guard checks)');
}

if (ctok) {
  await check('a cashier cannot read the devices table', async () => {
    const { status } = await post('/api/query', { sql: 'SELECT id, name FROM devices' }, ctok);
    assert(status === 403, 'expected 403, got ' + status);
  });

  await check('a cashier cannot mint a pairing code', async () => {
    const { status } = await post('/api/execute', {
      sql: "INSERT INTO devices (shop_id, kind, name, pairing_code) VALUES (1, 'mobile', 'x', 'BADBAD00')",
    }, ctok);
    assert(status === 403, 'expected 403, got ' + status);
    const rows = await q('SELECT id FROM devices WHERE pairing_code = $1', ['BADBAD00'], atok);
    assert(rows.length === 0, 'the denied insert must not have created a row');
  });

  await check("a cashier cannot revoke someone else's phone", async () => {
    const { status } = await post('/api/execute', {
      sql: 'UPDATE devices SET revoked = TRUE WHERE id = (SELECT MIN(id) FROM devices)',
    }, ctok);
    assert(status === 403, 'expected 403, got ' + status);
  });
}

let deviceId = null;
let code = null;

await check('an admin can mint a code for a new phone', async () => {
  const created = await post('/api/execute', {
    sql: 'INSERT INTO devices (shop_id, kind, name, pairing_code) VALUES (1, $1, $2, $3) RETURNING id',
    params: ['mobile', 'e2e pairing phone', newPairingCode()],
  }, atok);
  assert(created.status === 200, 'insert failed: ' + JSON.stringify(created.body));
  deviceId = Number(created.body.rows[0].id);
  assert(deviceId, 'no id returned');
  const [row] = await q('SELECT pairing_code FROM devices WHERE id = $1', [deviceId], atok);
  code = row.pairing_code;
  assert(/^[0-9A-F]{8}$/.test(code), 'stored code looks wrong: ' + code);
});

await check('an unclaimed phone is "waiting" for setup', async () => {
  const [row] = await q('SELECT pairing_code, revoked FROM devices WHERE id = $1', [deviceId], atok);
  assert(row.pairing_code && row.revoked === false, 'should be pending, got ' + JSON.stringify(row));
});

let token = null;

await check('the phone exchanges the code for a device token', async () => {
  const paired = await post('/api/v1/devices/pair', { code, name: 'e2e phone' });
  assert(paired.status === 200, 'pairing failed: ' + JSON.stringify(paired.body));
  token = paired.body.token;
  assert(token, 'no token returned');
  assert(paired.body.device && paired.body.device.id === deviceId, 'wrong device returned');
});

await check('the code is spent and cannot be used twice', async () => {
  const again = await post('/api/v1/devices/pair', { code });
  assert(again.status === 401, 'a used code must be rejected, got ' + again.status);
  const [row] = await q('SELECT pairing_code FROM devices WHERE id = $1', [deviceId], atok);
  assert(row.pairing_code === null, 'pairing_code should be cleared, got ' + row.pairing_code);
});

await check('the device token can sync the shop', async () => {
  const res = await fetch(BASE + '/api/v1/pull?since=0', { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json();
  assert(res.status === 200, 'pull failed: ' + JSON.stringify(data).slice(0, 120));
  assert(data.changes && typeof data.changes === 'object', 'no changes object returned');
});

await check('many phones can be added, one code at a time', async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = await post('/api/execute', {
      sql: 'INSERT INTO devices (shop_id, kind, name, pairing_code) VALUES (1, $1, $2, $3) RETURNING id',
      params: ['mobile', 'e2e extra phone ' + (i + 1), newPairingCode()],
    }, atok);
    assert(r.status === 200, 'insert ' + i + ' failed');
    ids.push(Number(r.body.rows[0].id));
  }
  const rows = await q(
    "SELECT id FROM devices WHERE name LIKE 'e2e extra phone%' AND pairing_code IS NOT NULL", [], atok
  );
  assert(rows.length === 3, 'expected 3 pending phones, got ' + rows.length);
  for (const id of ids) {
    await post('/api/execute', { sql: 'DELETE FROM devices WHERE id = $1', params: [id] }, atok);
  }
});

await check('a revoked phone cannot pair', async () => {
  const c = newPairingCode();
  const r = await post('/api/execute', {
    sql: 'INSERT INTO devices (shop_id, kind, name, pairing_code) VALUES (1, $1, $2, $3) RETURNING id',
    params: ['mobile', 'e2e revoked phone', c],
  }, atok);
  const id = Number(r.body.rows[0].id);
  await post('/api/execute', {
    sql: 'UPDATE devices SET revoked = TRUE, pairing_code = NULL WHERE id = $1', params: [id],
  }, atok);
  const paired = await post('/api/v1/devices/pair', { code: c });
  assert(paired.status === 401, 'a revoked device must not pair, got ' + paired.status);
  await post('/api/execute', { sql: 'DELETE FROM devices WHERE id = $1', params: [id] }, atok);
});

await check('the shop can see how many phones are connected', async () => {
  // Exactly the query src/lib/pairing.ts listDevices() runs. It is here because
  // that query shipped with `ORDER BY (revoked ASC), (pairing_code IS NOT NULL
  // DESC)`, which Postgres rejects - a direction can only qualify a column
  // name. The Phones & Devices panel was dead on arrival and nothing caught it,
  // because the desktop tests run on SQLite, which accepts the same text.
  const rows = await q(
    `SELECT id, kind, name, pairing_code, last_sync_at, created_at, revoked,
            sync_requested_at,
            (revoked OR pairing_code IS NOT NULL) AS needs_attention
       FROM devices
      ORDER BY needs_attention DESC, id DESC`,
    [], atok
  );
  assert(rows.length > 0, 'expected the shop to have devices');
  assert('needs_attention' in rows[0], 'needs_attention is missing from the result');
});

await check('the shop can ask a phone to sync, and the phone is told', async () => {
  await post('/api/execute', {
    sql: 'UPDATE devices SET sync_requested_at = NOW() WHERE id = $1', params: [deviceId],
  }, atok);
  const res = await fetch(BASE + '/api/v1/pull?since=0', { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json();
  assert(res.status === 200, 'pull failed: ' + JSON.stringify(data).slice(0, 120));
  assert(data.sync_requested_at, 'the pull did not carry the shop\'s request to the phone');
});

await check('the phone clears the note once it has synced', async () => {
  const res = await fetch(BASE + '/api/v1/pull?since=0', { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json();
  assert(data.sync_requested_at, 'expected an outstanding request to acknowledge');

  const ack = await post('/api/v1/sync-request/ack', {}, token);
  assert(ack.status === 200, 'ack failed: ' + JSON.stringify(ack.body));
  assert(ack.body.cleared === 1, 'expected to clear exactly one request, got ' + ack.body.cleared);

  const [row] = await q('SELECT sync_requested_at FROM devices WHERE id = $1', [deviceId], atok);
  assert(row.sync_requested_at === null, 'the note survived the ack');
});

await check('a note left after the phone last synced is kept', async () => {
  // The phone pulled a moment ago, so last_sync_at is older than this new note.
  // Clearing it here would tell the shop its request had been answered when the
  // phone had not even seen it yet.
  await post('/api/execute', {
    sql: 'UPDATE devices SET sync_requested_at = NOW() WHERE id = $1', params: [deviceId],
  }, atok);
  const ack = await post('/api/v1/sync-request/ack', {}, token);
  assert(ack.status === 200, 'ack failed: ' + JSON.stringify(ack.body));
  assert(ack.body.cleared === 0, 'a request the phone never saw was cleared');

  const [row] = await q('SELECT sync_requested_at FROM devices WHERE id = $1', [deviceId], atok);
  assert(row.sync_requested_at !== null, 'the unseen request was wrongly cleared');

  // After the phone syncs again the note is genuinely handled and goes.
  await fetch(BASE + '/api/v1/pull?since=0', { headers: { Authorization: 'Bearer ' + token } });
  const second = await post('/api/v1/sync-request/ack', {}, token);
  assert(second.body.cleared === 1, 'the note should clear after a later sync, got ' + second.body.cleared);
});

await check('a phone can tell whether the shop still knows it', async () => {
  const anon = await fetch(BASE + '/api/v1/ping');
  assert(anon.status === 401, 'ping must not answer without a token, got ' + anon.status);

  const res = await fetch(BASE + '/api/v1/ping', { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json();
  assert(res.status === 200, 'ping failed: ' + JSON.stringify(data).slice(0, 120));
  assert(data.ok === true, 'ping did not report ok');
  assert(data.device && data.device.id === deviceId, 'ping returned the wrong device');
  assert(data.counts && typeof data.counts.customers === 'number',
    'ping did not report the shop\'s row counts');
});

await check('a revoked phone cannot ping the shop', async () => {
  await post('/api/execute', {
    sql: 'UPDATE devices SET revoked = TRUE WHERE id = $1', params: [deviceId],
  }, atok);
  const res = await fetch(BASE + '/api/v1/ping', { headers: { Authorization: 'Bearer ' + token } });
  assert(res.status === 401, 'a revoked device must not be served, got ' + res.status);
  await post('/api/execute', {
    sql: 'UPDATE devices SET revoked = FALSE WHERE id = $1', params: [deviceId],
  }, atok);
});

await check('cleanup', async () => {
  if (deviceId) {
    await post('/api/execute', { sql: 'DELETE FROM devices WHERE id = $1', params: [deviceId] }, atok);
  }
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
