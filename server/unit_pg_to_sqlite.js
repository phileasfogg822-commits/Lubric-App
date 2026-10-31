/**
 * Unit tests for pgToSqlite (src/lib/localDb.ts), the PostgreSQL → SQLite
 * translation the phone's local mode runs every query through.
 *
 * Run:  node --experimental-strip-types server/unit_pg_to_sqlite.js
 */

import { pgToSqlite } from '../src/lib/localDb.ts';

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { console.log(`FAIL - ${title}: ${e.message}`); }
}
function eq(a, b) {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

check('nextval(pg_get_serial_sequence) becomes max+1 (the sale reserve query)', () => {
  eq(
    pgToSqlite("SELECT nextval(pg_get_serial_sequence('orders', 'id')) AS oid"),
    "SELECT (SELECT COALESCE(MAX(id), 0) + 1 FROM orders) AS oid"
  );
});

check('nextval translation works for any table/column', () => {
  eq(
    pgToSqlite("SELECT nextval(pg_get_serial_sequence('invoices', 'num'))"),
    "SELECT (SELECT COALESCE(MAX(num), 0) + 1 FROM invoices)"
  );
});

check('existing translations still apply', () => {
  eq(pgToSqlite("SELECT NOW(), a ILIKE b, TRUE, FALSE"), "SELECT datetime('now'), a LIKE b, 1, 0");
  eq(pgToSqlite("SELECT date_trunc('day', created_at)"), "SELECT date(created_at)");
});

check('plain SQL passes through untouched', () => {
  eq(
    pgToSqlite("SELECT id FROM vehicles WHERE customer_id = $1 ORDER BY id DESC LIMIT 1"),
    "SELECT id FROM vehicles WHERE customer_id = $1 ORDER BY id DESC LIMIT 1"
  );
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
