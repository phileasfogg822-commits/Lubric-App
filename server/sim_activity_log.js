/**
 * Team activity log — admin-only (Umar, 2026-11-28):
 *
 *   Every action a team member takes lands in activity_log (add / edit /
 *   delete / view / void / login) with the member's name, so the admin can
 *   see who did what, when. The page is admin-only three ways: the route
 *   (/activity, RequireAdmin in App.tsx), the page itself (isAdmin), and
 *   the server classifier (activity_log reads return an unholdable key —
 *   the admin bypass runs before it is consulted).
 *
 * This sim builds the REAL local schema in SQLite, inserts rows with the
 * REAL statement from src/lib/activityLog.ts, and reads them back the way
 * the Activity page does — newest first, filtered by member / action /
 * date. It also runs the REAL requiredPermissions from server/index.js
 * over the log's statements, and checks the server migration carries the
 * table, the RLS switch and the outlet policy.
 *
 * Run:  node --experimental-strip-types server/sim_activity_log.js
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ensureLocalSchema,
  pgToSqlite,
  LOCAL_SCHEMA_10,
} from '../src/lib/localDb.ts';

const ACTIVITY_TS = readFileSync(new URL('../src/lib/activityLog.ts', import.meta.url), 'utf8');
const ACTIVITY_TSX = readFileSync(new URL('../src/modules/activity/ActivityLog.tsx', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const MIGRATION_037 = readFileSync(new URL('./migrations/037_activity_log.sql', import.meta.url), 'utf8');
const SERVER_INDEX = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

// ── the REAL permission machinery, as sim_sale_permissions.js extracts it ──
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in server/index.js`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(`could not match braces for ${name}`);
  return src.slice(start, i + 1);
}
const permSrc = SERVER_INDEX.slice(SERVER_INDEX.indexOf('const P = {'), SERVER_INDEX.indexOf('const permCache'));
const requiredPermissions = new Function(
  permSrc + '\n' + extractFunction(SERVER_INDEX, 'requiredPermissions') + '\nreturn requiredPermissions;'
)();

// ── sqlx-faithful binding (copied from sim_sale_payment_options.js) ────────
function sqlxBind(sql, params = []) {
  let out = '';
  const ordered = [];
  let unnamed = 0, single = false, dbl = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (single) {
      out += ch;
      if (ch === "'") { if (sql[i + 1] === "'") out += sql[++i]; else single = false; }
      continue;
    }
    if (dbl) {
      out += ch;
      if (ch === '"') { if (sql[i + 1] === '"') out += sql[++i]; else dbl = false; }
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
    if (ch === '?') { ordered.push(params[unnamed++]); out += '?'; continue; }
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
  return { raw, db, run };
}

let ok = 0, total = 0, failed = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`  PASS ${title}`); }
  catch (e) { failed++; console.log(`  FAIL ${title}: ${e.message}`); }
}
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}

function allowed(sql, perms) {
  const need = requiredPermissions(sql);
  return need === null || need.some((p) => perms.includes(p));
}

// The REAL insert statement, extracted verbatim from the helper — the sim
// runs the helper's own SQL, not a copy of it.
const INSERT_SQL = (() => {
  const m = ACTIVITY_TS.match(/"INSERT INTO activity_log \([^"]+\) VALUES \([^"]+\)"/);
  assert(m, 'helper INSERT statement not found in activityLog.ts');
  return m[0].slice(1, -1);
})();

const { raw, db, run } = makeDb();
await ensureLocalSchema(db);

console.log('\nTable — the real local schema');
check('activity_log exists after ensureLocalSchema, with the helper columns', () => {
  const cols = run("SELECT name FROM pragma_table_info('activity_log')").map((r) => r.name);
  for (const c of ['shop_id', 'user_id', 'user_name', 'action', 'entity', 'entity_id', 'detail', 'created_at']) {
    assert(cols.includes(c), `missing column ${c} (have: ${cols.join(', ')})`);
  }
});
check('re-running the schema statement keeps the rows (IF NOT EXISTS)', () => {
  run(INSERT_SQL, [1, 7, 'Ayesha', 'login', 'user', 7, 'Signed in as ayesha@shop.pk']);
  raw.exec(LOCAL_SCHEMA_10);
  const n = run('SELECT COUNT(*) AS c FROM activity_log')[0].c;
  assert(Number(n) === 1, `expected 1 row after re-run, got ${n}`);
});
check('LOCAL_SCHEMA_10 is the table the helper writes', () => {
  assert(LOCAL_SCHEMA_10.includes('CREATE TABLE IF NOT EXISTS activity_log'), 'LOCAL_SCHEMA_10 does not create activity_log');
  assert(LOCAL_SCHEMA_10.includes('idx_activity_log_created'), 'LOCAL_SCHEMA_10 has no created index');
});

console.log('\nRows — the helper statement, the page query');
check('three actions land and read back newest-first', () => {
  run(INSERT_SQL, [1, 3, 'Bilal', 'add', 'customer', 12, 'Ahmed (from sale)']);
  run(INSERT_SQL, [1, 3, 'Bilal', 'delete', 'expense', 5, 'Shop / Rent — 2000']);
  run(INSERT_SQL, [1, 7, 'Ayesha', 'view', 'customers', null, '']);
  const rows = run('SELECT user_name, action, entity FROM activity_log ORDER BY created_at DESC, id DESC');
  assert(rows.length === 4, `expected 4 rows, got ${rows.length}`);
  assert(rows[0].action === 'view' && rows[0].user_name === 'Ayesha', 'newest row is not the view');
  assert(rows[3].action === 'login', 'oldest row is not the login');
});
check('member and action filters narrow the log', () => {
  const bilal = run("SELECT id FROM activity_log WHERE user_name = $1 ORDER BY id DESC", ['Bilal']);
  assert(bilal.length === 2, `expected 2 Bilal rows, got ${bilal.length}`);
  const deletes = run("SELECT id FROM activity_log WHERE action = $1", ['delete']);
  assert(deletes.length === 1, `expected 1 delete, got ${deletes.length}`);
});
check('the member dropdown query lists distinct members', () => {
  const members = run("SELECT DISTINCT user_name FROM activity_log WHERE user_name <> '' ORDER BY user_name");
  assert(members.map((m) => m.user_name).join(',') === 'Ayesha,Bilal', 'distinct members wrong: ' + JSON.stringify(members));
});
check('the page query text is portable (substr day filter, no to_char)', () => {
  assert(ACTIVITY_TSX.includes("substr(created_at::text, 1, 10)"), 'page does not use the portable day filter');
  assert(!ACTIVITY_TSX.includes('to_char'), 'page uses Postgres-only to_char');
});

console.log('\nServer — reads admin-only, writes append-only');
check('a SELECT on activity_log needs the unholdable admin key', () => {
  const need = requiredPermissions('SELECT id, user_name, action FROM activity_log ORDER BY created_at DESC LIMIT 500');
  assert(JSON.stringify(need) === JSON.stringify(['__admin__']), 'read must need exactly __admin__, got ' + JSON.stringify(need));
  assert(!allowed('SELECT * FROM activity_log', ['team.manage']), 'team.manage must NOT read the log');
  assert(!allowed('SELECT * FROM activity_log', ['dashboard', 'pos.create', 'customers.add']), 'a cashier must NOT read the log');
});
check('INSERT is open to any authenticated member; UPDATE/DELETE are admin-only', () => {
  const ins = "INSERT INTO activity_log (shop_id, user_id, user_name, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)";
  assert(requiredPermissions(ins) === null, 'INSERT must need nothing');
  assert(allowed(ins, ['customers.add']), 'a cashier must be able to record their own action');
  assert(JSON.stringify(requiredPermissions('UPDATE activity_log SET detail = $1 WHERE id = $2')) === JSON.stringify(['__admin__']), 'UPDATE must need __admin__');
  assert(JSON.stringify(requiredPermissions('DELETE FROM activity_log WHERE id = $1')) === JSON.stringify(['__admin__']), 'DELETE must need __admin__');
});

console.log('\nServer migration 037 — table, RLS, outlet policy');
check('migration 037 creates the table and the index, idempotently', () => {
  assert(MIGRATION_037.includes('CREATE TABLE IF NOT EXISTS activity_log'), 'no CREATE TABLE IF NOT EXISTS');
  assert(MIGRATION_037.includes('CREATE INDEX IF NOT EXISTS idx_activity_log_created'), 'no index');
  assert(!/^\s*(UPDATE|INSERT|DELETE)\s/m.test(MIGRATION_037), 'migration must not write data rows');
});
check('migration 037 enables RLS (force) and the shop_isolation policy', () => {
  assert(MIGRATION_037.includes('ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY'), 'no ENABLE ROW LEVEL SECURITY');
  assert(MIGRATION_037.includes('ALTER TABLE activity_log FORCE ROW LEVEL SECURITY'), 'no FORCE ROW LEVEL SECURITY');
  assert(MIGRATION_037.includes('CREATE POLICY shop_isolation ON activity_log'), 'no shop_isolation policy');
  assert(MIGRATION_037.includes("current_setting('app.shop_id'"), 'policy does not scope on app.shop_id');
});

console.log('\nPage and route — admin-only three ways');
check('/activity is wrapped in RequireAdmin, not a permission key', () => {
  assert(APP.includes('<Route path="/activity" element={<RequireAdmin><ActivityLog /></RequireAdmin>}'), '/activity is not RequireAdmin-gated');
  assert(!APP.includes('permission="activity"'), 'there must be no activity permission key');
});
check('the page itself refuses non-admins and only queries when admin', () => {
  assert(ACTIVITY_TSX.includes('if (!isAdmin)'), 'page has no isAdmin refusal');
  assert(ACTIVITY_TSX.includes('enabled: isAdmin'), 'page queries are not gated on isAdmin');
});

console.log(`\n${ok}/${total} checks passed${failed ? ` — ${failed} FAILED` : ''}`);
if (failed) process.exit(1);
