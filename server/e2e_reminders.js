import { query } from './db.js';

const BASE = 'http://localhost:3001';

async function post(path, body, token) {
  const headers = token
    ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
    : { 'Content-Type': 'application/json' };
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, body: j };
}

async function auth(email, pass) {
  const { status, body } = await post('/api/auth/login', { email, password: pass });
  if (status !== 200) throw new Error('Auth failed for ' + email + ': ' + status);
  return body.token;
}

async function check(title, fn) {
  try { await fn(); console.log('  PASS ' + title); return true; }
  catch (e) { console.log('  FAIL ' + title + ': ' + e.message); return false; }
}

// ---------- main ----------
async function main() {
  let ok = 0, total = 0;

  // --- Auth ---
  let atok = null, ctok = null;
  try { atok = await auth('admin@lubric.app', 'admin123'); } catch (e) { console.log('admin auth error:', e.message); }
  try { ctok = await auth('cashier@lubric.app', 'cashier123'); } catch (e) { console.log('cashier auth error:', e.message); }
  console.log('Auth tokens - admin:', !!atok, 'cashier:', !!ctok);

  // 1. unauthorised query -> 401
  total++; ok += await check('unauth query -> 401', async () => {
    const { status } = await post('/api/query', { sql: 'SELECT 1' });
    if (status !== 401) throw new Error('expected 401, got ' + status);
  });

  // 2. admin can query reminders table
  total++; ok += await check('admin can query reminders', async () => {
    const { status, body } = await post('/api/query', { sql: 'SELECT COUNT(*)::int AS c FROM reminders' }, atok);
    if (status !== 200) throw new Error('query status=' + status + ' ' + JSON.stringify(body));
    if (!Array.isArray(body) || typeof body[0]?.c !== 'number') throw new Error('bad rows: ' + JSON.stringify(body));
  });

  // 3. cashier can query reminders (has dashboard permission)
  total++; ok += await check('cashier can query reminders', async () => {
    const { status, body } = await post('/api/query', { sql: 'SELECT COUNT(*)::int AS c FROM reminders' }, ctok);
    if (status !== 200) throw new Error('query status=' + status + ' ' + JSON.stringify(body));
    if (!Array.isArray(body) || typeof body[0]?.c !== 'number') throw new Error('bad rows');
  });

  // 4. create a reminder via /api/execute (admin)
  total++; ok += await check('create reminder (admin)', async () => {
    const before = ((await post('/api/query', { sql: 'SELECT COUNT(*)::int AS c FROM reminders' }, atok)).body[0].c);
    const { status, body } = await post('/api/execute', {
      sql: "INSERT INTO reminders (shop_id, kind, title, details, due_at, priority, created_by_user_id) VALUES (1, 'todo', $1, $2, $3, $4, $5) RETURNING id",
      params: ['E2E test reminder', 'test details', '2026-09-23T09:00:00Z', 'normal', 1]
    }, atok);
    if (status !== 200) throw new Error('create status=' + status + ' ' + JSON.stringify(body));
    if (!body.rows || !body.rows.length || !body.rows[0].id) throw new Error('missing id in ' + JSON.stringify(body));
    globalThis._e2e_id = body.rows[0].id;
    const after = ((await post('/api/query', { sql: 'SELECT COUNT(*)::int AS c FROM reminders' }, atok)).body[0].c);
    if (after !== before + 1) throw new Error('count mismatch ' + before + '->' + after);
  });

  // 5. read the created reminder via /api/query
  total++; ok += await check('read single reminder', async () => {
    const { status, body } = await post('/api/query', { sql: 'SELECT * FROM reminders WHERE id = $1', params: [globalThis._e2e_id] }, atok);
    if (status !== 200) throw new Error('read status=' + status);
    if (!body.length || body[0].id !== globalThis._e2e_id) throw new Error('reminder not found');
    if (body[0].title !== 'E2E test reminder') throw new Error('title mismatch: ' + body[0].title);
    if (body[0].status !== 'pending') throw new Error('status not pending');
  });

  // 6. update reminder status via /api/execute
  total++; ok += await check('update reminder', async () => {
    const { status, body } = await post('/api/execute', {
      sql: 'UPDATE reminders SET status = $1, priority = $2, updated_at = now() WHERE id = $3 RETURNING id, status, priority',
      params: ['done', 'high', globalThis._e2e_id]
    }, atok);
    if (status !== 200) throw new Error('update status=' + status + ' ' + JSON.stringify(body));
    if (!body.rows || !body.rows.length) throw new Error('no rows returned');
    if (body.rows[0].status !== 'done' || body.rows[0].priority !== 'high') throw new Error('update fields mismatch');
  });

  // 7. verify update persisted
  total++; ok += await check('verify update persisted', async () => {
    const { status, body } = await post('/api/query', { sql: 'SELECT status, priority FROM reminders WHERE id = $1', params: [globalThis._e2e_id] }, atok);
    if (status !== 200) throw new Error('read status=' + status);
    if (body[0].status !== 'done' || body[0].priority !== 'high') throw new Error('persisted fields mismatch');
  });

  // 8. delete reminder via /api/execute
  total++; ok += await check('delete reminder', async () => {
    const before = ((await post('/api/query', { sql: 'SELECT COUNT(*)::int AS c FROM reminders' }, atok)).body[0].c);
    const { status, body } = await post('/api/execute', {
      sql: 'DELETE FROM reminders WHERE id = $1 RETURNING id',
      params: [globalThis._e2e_id]
    }, atok);
    if (status !== 200) throw new Error('delete status=' + status + ' ' + JSON.stringify(body));
    if (!body.rows || !body.rows.length) throw new Error('delete returned no rows');
    const after = ((await post('/api/query', { sql: 'SELECT COUNT(*)::int AS c FROM reminders' }, atok)).body[0].c);
    if (after !== before - 1) throw new Error('delete count mismatch ' + before + '->' + after);
  });

  // 9. cashier can use transaction endpoint
  total++; ok += await check('cashier transaction (insert + select)', async () => {
    const { status, body } = await post('/api/transaction', {
      statements: [
        { sql: 'INSERT INTO reminders (shop_id, kind, title, priority, created_by_user_id) VALUES (1, $1, $2, $3, $4) RETURNING id', params: ['todo', 'txn test', 'low', 2] },
        { sql: 'SELECT COUNT(*)::int AS c FROM reminders' }
      ]
    }, ctok);
    if (status !== 200) throw new Error('txn status=' + status + ' ' + JSON.stringify(body));
    if (!body.results || body.results.length < 2) throw new Error('bad txn results');
    if (!body.results[0].rows || !body.results[0].rows[0]?.id) throw new Error('txn insert returned no id');
    const txnId = body.results[0].rows[0].id;
    await post('/api/execute', { sql: 'DELETE FROM reminders WHERE id = $1', params: [txnId] }, ctok);
  });

  console.log('\n' + ok + '/' + total + ' checks passed');
  process.exit(ok === total ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
