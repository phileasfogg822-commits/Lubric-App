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

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'lubricapp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Test connection
pool.on('error', (err) => {
  console.error('Unexpected idle client error', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('Executed query', { text: text.substring(0, 80), duration, rows: res.rowCount });
  }
  return res;
}

export async function getClient() {
  return pool.connect();
}

export default pool;
