import pg from 'pg';
const { Pool, types } = pg;

// node-postgres returns NUMERIC (OID 1700) as a STRING, deliberately, so no
// driver silently loses precision on values a double cannot hold.
//
// That default is wrong for this app. Every total in the browser is computed in
// JavaScript - `reduce((s, x) => s + x.line_total, 0)` in the POS cart, the
// dashboard tiles, the reports - and `"0" + "4321.50"` is string concatenation,
// not addition. Migrating money to NUMERIC without this parser would silently
// turn every total on screen into a concatenated string.
//
// The split of responsibility, which is the standard arrangement for this
// stack: the DATABASE is exact. Every figure that matters - ledger balances,
// statements, P&L, receivable totals - is a SUM() evaluated in SQL over
// NUMERIC columns, so it is arithmetically exact. The parser below is only
// about the value crossing the wire for display and for client-side arithmetic,
// where a JS double is what the browser can hold anyway.
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));

const base = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'lubricapp',
  password: process.env.DB_PASSWORD || 'postgres',
};

// ── two roles, deliberately ────────────────────────────────────────────────
// migrations connect as the SUPERUSER (DB_ADMIN_USER, falling back to DB_USER),
// because a superuser bypasses row-level security unconditionally. Schema
// changes, backfills and reconciliation must see every outlet regardless of
// what shop context is set - and enabling RLS on the tables a migration is
// still writing to would make the migration see zero rows.
//
// the app connects as DB_APP_USER, a NOSUPERUSER NOBYPASSRLS role, which is the
// only kind of role Postgres will actually constrain. Until migration 030
// enables RLS this variable falls back to DB_USER, so behaviour is unchanged on
// this deploy and the switch happens on the next, once the app is proven to set
// the shop context on every request.
const adminPool = new Pool({
  ...base,
  user: process.env.DB_ADMIN_USER || process.env.DB_USER || 'postgres',
});

const pool = new Pool({
  ...base,
  user: process.env.DB_APP_USER || process.env.DB_USER || 'postgres',
  // The app role has its OWN password, not the superuser's. Falling back to
  // base.password (DB_PASSWORD) is what makes this fail in a way that looks
  // like a credential problem rather than a wiring one: Postgres reports
  // "password authentication failed for user lubric_app", which sends you
  // hunting the role when the role is fine and the client is simply sending the
  // wrong secret.
  password: process.env.DB_APP_PASSWORD || base.password,
});

adminPool.on('error', (err) => {
  console.error('Unexpected idle admin client error', err);
});
pool.on('error', (err) => {
  console.error('Unexpected idle client error', err);
});

/**
 * Run `fn` with the outlet context set for this transaction only.
 *
 * `set_config(..., true)` is is_local=true: the value lives for the duration of
 * the transaction and is discarded on COMMIT/ROLLBACK. That is the only safe way
 * to set it on a POOL. Setting it session-wide (is_local=false) would leave the
 * value on a pooled connection that the next request then reuses - outlet A's
 * request would return outlet B's rows. Silent, intermittent, and very hard to
 * diagnose, which is why it is worth being explicit about here.
 *
 * BEGIN first: outside a transaction is_local=true has no scope, so the setting
 * would be discarded immediately and the policy would see NULL and hide
 * everything. Fail closed, but not THAT closed.
 */
export async function withShop(shopId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.shop_id', $1, true)", [String(shopId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Query the database, optionally scoped to an outlet.
 *
 * shopId is optional: passing null means unscoped, which is what auth, health
 * checks and migrations need. Callers that serve business data must pass it,
 * because that is what makes row security apply.
 */
export async function query(text, params, shopId) {
  const start = Date.now();
  const res = shopId == null
    ? await pool.query(text, params)
    : await withShop(shopId, (client) => client.query(text, params));
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('Executed query', { text: text.substring(0, 80), duration, rows: res.rowCount });
  }
  return res;
}

export async function getClient() {
  return pool.connect();
}

export { adminPool };
export default pool;
