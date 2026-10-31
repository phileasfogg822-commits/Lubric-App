/**
 * Unit tests for the offline write hook (src/lib/outbox.ts).
 *
 * Covers the pure pieces — uuid injection into INSERTs, trigger SQL shape —
 * and then runs the GENERATED trigger SQL in real SQLite (node:sqlite) to
 * prove inserts/updates/deletes actually land in sync_outbox, and that
 * dropping the triggers (the pull guard) stops them.
 *
 * Run:  node --experimental-strip-types server/unit_outbox.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  buildTriggerSql, dropTriggerSql, ensureOutboxTriggers, dropOutboxTriggers,
  injectUuid, newUuid, SOFT_DELETE_TABLES,
} from '../src/lib/outbox.ts';

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { console.log(`FAIL - ${title}: ${e.message}`); }
}
async function checkAsync(title, fn) {
  total++;
  try { await fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { console.log(`FAIL - ${title}: ${e.message}`); }
}
function eq(a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`expected ${sb}, got ${sa}`);
}

const TABLES = ['products', 'orders', 'customers'];

// ---- injectUuid ----
check('injectUuid appends uuid column, placeholder and param', () => {
  const r = injectUuid('INSERT INTO products (name, price_returning) VALUES ($1, $2)', ['Tea', 500], TABLES);
  if (!r) throw new Error('expected a rewrite');
  eq(r.sql, 'INSERT INTO products (name, price_returning, uuid) VALUES ($1, $2, ?)');
  eq(r.params.slice(0, 2), ['Tea', 500]);
  if (typeof r.params[2] !== 'string' || r.params[2].length < 32) throw new Error('uuid param missing');
});

check('injectUuid leaves statements that already carry uuid alone', () => {
  eq(injectUuid('INSERT INTO products (name, uuid) VALUES ($1, $2)', ['Tea', 'u1'], TABLES), null);
});

check('injectUuid leaves non-replicated tables alone', () => {
  eq(injectUuid('INSERT INTO shops (name) VALUES ($1)', ['S'], TABLES), null);
});

check('injectUuid leaves column-less INSERTs alone', () => {
  eq(injectUuid('INSERT INTO products VALUES ($1, $2)', ['Tea', 500], TABLES), null);
});

check('injectUuid leaves multi-row VALUES alone', () => {
  eq(injectUuid('INSERT INTO products (name) VALUES ($1), ($2)', ['A', 'B'], TABLES), null);
});

check('injectUuid handles OR IGNORE and keeps RETURNING', () => {
  const r = injectUuid('INSERT OR IGNORE INTO customers (name) VALUES ($1) RETURNING id', ['Ali'], TABLES);
  if (!r) throw new Error('expected a rewrite');
  eq(r.sql, 'INSERT OR IGNORE INTO customers (name, uuid) VALUES ($1, ?) RETURNING id');
});

check('injectUuid survives a literal parenthesis in VALUES', () => {
  const r = injectUuid("INSERT INTO products (name) VALUES ($1)", ['a(b'], TABLES);
  if (!r) throw new Error('expected a rewrite');
  eq(r.sql, 'INSERT INTO products (name, uuid) VALUES ($1, ?)');
});

check('injectUuid ignores UPDATE/DELETE/SELECT', () => {
  eq(injectUuid('UPDATE products SET name = $1 WHERE id = $2', ['X', 1], TABLES), null);
  eq(injectUuid('DELETE FROM products WHERE id = $1', [1], TABLES), null);
  eq(injectUuid('SELECT * FROM products', [], TABLES), null);
});

check('newUuid looks like a UUID', () => {
  const u = newUuid();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u)) throw new Error(`bad uuid: ${u}`);
});

// ---- trigger SQL shape ----
check('soft-delete tables get insert/update/delete triggers', () => {
  const sqls = buildTriggerSql('products', ['id', 'uuid', 'name', 'shop_id']);
  eq(sqls.length, 3);
  if (!sqls[0].includes('AFTER INSERT') || !sqls[0].includes("'insert'")) throw new Error('ins trigger wrong');
  if (!sqls[1].includes('AFTER UPDATE') || !sqls[1].includes("'update'")) throw new Error('upd trigger wrong');
  if (!sqls[2].includes('AFTER DELETE') || !sqls[2].includes("'delete'")) throw new Error('del trigger wrong');
  if (sqls[0].includes("'id', NEW.id")) throw new Error('id must be excluded from payload');
  if (!sqls[0].includes("'name', NEW.name")) throw new Error('payload must carry name');
  if (!sqls[0].includes('WHEN NEW.uuid IS NOT NULL')) throw new Error('WHEN guard missing');
});

check('append-only tables get no delete trigger', () => {
  const sqls = buildTriggerSql('orders', ['id', 'uuid', 'total']);
  eq(sqls.length, 2);
  if (sqls.some((s) => s.includes('AFTER DELETE'))) throw new Error('orders must not get a delete trigger');
});

check('tables without a uuid column get no triggers', () => {
  eq(buildTriggerSql('price_list_items', ['id', 'price']), []);
});

check('SOFT_DELETE_TABLES matches the server list', () => {
  eq([...SOFT_DELETE_TABLES].sort(), ['customers', 'expenses', 'products', 'services', 'vehicles', 'vendors']);
});

check('dropTriggerSql drops all three', () => {
  eq(dropTriggerSql('products'), [
    'DROP TRIGGER IF EXISTS trg_products_ins',
    'DROP TRIGGER IF EXISTS trg_products_upd',
    'DROP TRIGGER IF EXISTS trg_products_del',
  ]);
});

// ---- real SQLite integration ----
function sqliteHandle() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    select: async (s, p = []) => db.prepare(s).all(...p),
    execute: async (s, p = []) => { db.prepare(s).run(...p); return { rowsAffected: 0, rows: [] }; },
  };
}

await checkAsync('triggers queue insert/update/delete in real SQLite', async () => {
  const h = sqliteHandle();
  h.db.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, uuid TEXT, name TEXT, shop_id INTEGER);
             CREATE TABLE sync_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_uuid TEXT NOT NULL, op TEXT NOT NULL DEFAULT 'insert', payload TEXT NOT NULL, queued_at TEXT DEFAULT (datetime('now')), attempts INTEGER DEFAULT 0, last_error TEXT);`);
  await ensureOutboxTriggers(h, ['products']);
  h.db.prepare(`INSERT INTO products (uuid, name, shop_id) VALUES (?, ?, ?)`).run('u-1', 'Tea', 1);
  h.db.prepare(`UPDATE products SET name = ? WHERE uuid = ?`).run('Green Tea', 'u-1');
  h.db.prepare(`DELETE FROM products WHERE uuid = ?`).run('u-1');
  const rows = h.db.prepare(`SELECT table_name, row_uuid, op, payload FROM sync_outbox ORDER BY id`).all();
  eq(rows.map((r) => [r.table_name, r.row_uuid, r.op]), [
    ['products', 'u-1', 'insert'],
    ['products', 'u-1', 'update'],
    ['products', 'u-1', 'delete'],
  ]);
  const first = JSON.parse(rows[0].payload);
  eq(first.name, 'Tea');
  if ('id' in first) throw new Error('payload must exclude id');
  h.db.close();
});

await checkAsync('rows with NULL uuid are not queued', async () => {
  const h = sqliteHandle();
  h.db.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, uuid TEXT, name TEXT);
             CREATE TABLE sync_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_uuid TEXT NOT NULL, op TEXT NOT NULL DEFAULT 'insert', payload TEXT NOT NULL);`);
  await ensureOutboxTriggers(h, ['products']);
  h.db.prepare(`INSERT INTO products (name) VALUES (?)`).run('NoUuid');
  eq(h.db.prepare(`SELECT COUNT(*) AS n FROM sync_outbox`).get().n, 0);
  h.db.close();
});

await checkAsync('dropping triggers stops queueing (the pull guard)', async () => {
  const h = sqliteHandle();
  h.db.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, uuid TEXT, name TEXT);
             CREATE TABLE sync_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_uuid TEXT NOT NULL, op TEXT NOT NULL DEFAULT 'insert', payload TEXT NOT NULL);`);
  await ensureOutboxTriggers(h, ['products']);
  await dropOutboxTriggers(h, ['products']);
  h.db.prepare(`INSERT INTO products (uuid, name) VALUES (?, ?)`).run('u-9', 'Pulled');
  eq(h.db.prepare(`SELECT COUNT(*) AS n FROM sync_outbox`).get().n, 0);
  // ...and recreating them resumes queueing.
  await ensureOutboxTriggers(h, ['products']);
  h.db.prepare(`INSERT INTO products (uuid, name) VALUES (?, ?)`).run('u-10', 'Local');
  eq(h.db.prepare(`SELECT COUNT(*) AS n FROM sync_outbox`).get().n, 1);
  h.db.close();
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
