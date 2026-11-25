/**
 * The 2067 that survives v7 — "error returned from database: (code: 2067)
 * UNIQUE constraint failed: order_items.uuid", reported 2026-11-25 ~17:37 PKT.
 * Batch 6 proved the sale is atomic now (stock no longer drops on a failed
 * sale, no half-committed transactions, the customer panel shows history),
 * so only the 2067 remains — and it is NOT cart-uuid reuse: the cart holds
 * no uuids at all (CartItem.id is a local React key), and completeSale's
 * order_items INSERT carries no uuid column. The uuid comes from injectUuid
 * (src/lib/outbox.ts), which appends a BARE `?` placeholder for it — and
 * that is the bug.
 *
 * Why a bare `?` is wrong on this driver (the local DB is
 * @tauri-apps/plugin-sql 2.4.0 = sqlx-sqlite 0.8.6):
 *
 *  1. tauri-plugin-sql's execute binds values in order with
 *     sqlx::query(&sql).bind(v) per value (tauri-plugin-sql src/wrapper.rs,
 *     DbPool::execute). The query string reaches sqlx untouched.
 *  2. sqlx's SQLite binder (sqlx-sqlite/src/arguments.rs,
 *     SqliteArguments::bind) walks parameter indices 1..=count and asks
 *     SQLite for each parameter's NAME. `$N` names bind values[N-1]. A bare
 *     `?` has NO name (sqlite3_bind_parameter_name returns NULL), so sqlx
 *     binds it from a positional counter that starts at 1 and counts ONLY
 *     unnamed parameters. The appended `?` is the only unnamed parameter,
 *     so it binds values[0] — the FIRST bound value, not the fresh uuid.
 *
 * So every injectUuid-injected uuid is actually values[0] of its own
 * statement: order_items.uuid = the order id (every line of one order
 * shares it, so the SECOND line of any multi-item sale 2067s);
 * orders.uuid = the order id; vehicles.uuid = the customer id (a second
 * vehicle for the same customer 2067s); containers.uuid = the product id;
 * account_transactions.uuid = the payment account id (the second sale on
 * the same account 2067s); used_oil_log.uuid = the drum id (1). A fresh
 * cart does not help: the same cart re-added fails the same way, because
 * the uuids never came from the cart. The batch-4/6 sims missed this
 * because their bind() helper modelled the trailing `?` as binding
 * params[maxN] — the correct binding, which the real driver does not do.
 *
 * The fix (this batch): injectUuid appends a NUMBERED placeholder `$K`
 * (K = highest $N in the statement + 1) instead of a bare `?`. sqlx binds
 * $K to values[K-1] = the fresh uuid; the Capacitor driver rewrites $n to
 * `?` positionally (capDb.ts), and the uuid is appended last in both the
 * SQL and the params, so it binds correctly there too; server mode never
 * runs injectUuid (it sends statements to /api/transaction untouched).
 *
 * The second half is the data the bug already left behind: v6 partial
 * commits stranded order_items rows whose uuid is an order id and whose
 * order never landed (orphans). The batch-4 patch NULLs only DUPLICATES,
 * so a lone orphan keeps its bogus uuid — and a later sale reusing that
 * gap oid (nextval is MAX(id)+1) 2067s against it. The launch repair
 * patchOrderItemsUuidOrphans NULLs orphan uuids (and drops their outbox
 * rows, so a bogus identity never pushes to the server).
 *
 * Run:  node --experimental-strip-types server/sim_sale_uuid_binding.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  ensureLocalSchema,
  pgToSqlite,
  LOCAL_SCHEMA,
  LOCAL_SCHEMA_2,
} from '../src/lib/localDb.ts';
import { injectUuid } from '../src/lib/outbox.ts';
import { SYNC_TABLES } from '../src/lib/sync.ts';
import { stockOut } from '../src/lib/stock.ts';
import { newUuid } from '../src/lib/uuid.ts';
import { packLitres } from '../src/lib/units.ts';

// ── sqlx-faithful binding ────────────────────────────────────────────────
// Models sqlx 0.8 SqliteArguments::bind exactly for the placeholder shapes
// this app produces ($1..$N, plus at most one trailing bare `?`):
//   $N  -> params[N-1]
//   `?` -> params[unnamed++] where unnamed counts bare `?` only, from 0.
// Quote-aware: a `$` or `?` inside '...' / "..." is data, not a placeholder.
function sqlxBind(sql, params = []) {
  let out = '';
  const ordered = [];
  let unnamed = 0;
  let single = false;
  let dbl = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (single) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") out += sql[++i];
        else single = false;
      }
      continue;
    }
    if (dbl) {
      out += ch;
      if (ch === '"') {
        if (sql[i + 1] === '"') out += sql[++i];
        else dbl = false;
      }
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
    if (ch === '?') {
      ordered.push(params[unnamed++]);
      out += '?';
      continue;
    }
    out += ch;
  }
  return { sql: out, params: ordered };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── one in-memory DB, schema init once ───────────────────────────────────
const raw = new DatabaseSync(':memory:');
const db = {
  execute: async (sql) => raw.exec(sql),
  select: async (sql) => raw.prepare(sql).all(),
};
function run(sql, params = []) {
  const b = sqlxBind(pgToSqlite(sql), params);
  return raw.prepare(b.sql).all(...b.params);
}
// Mirrors dbExecute's local path (src/lib/db.ts): injectUuid, then
// RETURNING via select, else execute.
function runExecute(sql, params = []) {
  const inj = injectUuid(sql, params, SYNC_TABLES);
  const finalSql = inj ? inj.sql : sql;
  const finalParams = inj ? inj.params : params;
  const b = sqlxBind(pgToSqlite(finalSql), finalParams);
  if (/\breturning\b/i.test(finalSql)) {
    return raw.prepare(b.sql).all(...b.params);
  }
  raw.prepare(b.sql).run(...b.params);
  return [];
}
// Mirrors dbTransaction's local path (src/lib/db.ts): injectUuid per
// statement at execution time, one BEGIN..COMMIT, ROLLBACK on error.
function runSaleTx(statements) {
  raw.exec('BEGIN');
  try {
    for (const s of statements) {
      const p = s.params ?? [];
      const inj = injectUuid(s.sql, p, SYNC_TABLES);
      const b = sqlxBind(pgToSqlite(inj ? inj.sql : s.sql), inj ? inj.params : p);
      raw.prepare(b.sql).run(...b.params);
    }
    raw.exec('COMMIT');
  } catch (e) {
    raw.exec('ROLLBACK');
    throw e;
  }
}

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try {
    fn();
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}
function assertThrows(fn, re, m) {
  let got = null;
  try { fn(); } catch (e) { got = e; }
  assert(got, (m || 'expected a throw') + ' — nothing threw');
  assert(re.test(got.message), (m || 'wrong error') + ' — got: ' + got.message);
}

// leftoverLitres, replicated from POSCart.tsx (see sim_sale_2067_deterministic.js).
function leftoverLitres(item) {
  const pack = packLitres(item.product);
  const cap = item.capacity ?? 0;
  if (pack <= 0 || cap <= 0 || cap >= pack) return 0;
  return Math.round((pack - cap) * 1000) / 1000;
}

// The exact completeSale statement construction (POSCart.tsx), copied
// verbatim from sim_sale_2067_deterministic.js; the stock ledger goes
// through the real stockOut().
function buildSaleStatements(oid, cart, customerId, userId, paymentAccountId, total, mileage, notes, vehicleId) {
  const statements = [
    {
      sql: `INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, vehicle_id, mileage, notes, created_at) VALUES ($1, 1, $2, $3, $4, $4, $5, 'cash', 'completed', $6, $7, $8, NOW())`,
      params: [oid, customerId, userId, total, paymentAccountId, vehicleId, mileage, notes],
    },
  ];
  for (const item of cart) {
    const lo = item.kind === 'product' ? leftoverLitres(item) : 0;
    const toContainers = item.kind === 'product' && !!item.leftoverToContainers && lo > 0;
    const byCapacity = item.kind === 'product' && !!item.billByCapacity;
    statements.push({
      sql: `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      params: [oid, item.kind, item.ref_id, item.name, item.qty, item.unit_price, item.line_total, item.container_id ?? null,
               item.kind === 'partial_container' ? item.qty : (item.kind === 'product' ? (item.capacity ?? 0) : 0), lo, toContainers ? 'container' : 'customer', false, byCapacity],
    });
    if (toContainers) {
      statements.push({
        sql: "INSERT INTO containers (shop_id, product_id, original_volume, remaining_volume, status, opened_at, source_order_id) VALUES (1, $1, $2, $3, 'opened', NOW()::text, $4)",
        params: [item.ref_id, packLitres(item.product) || lo, lo, oid],
      });
    }
    if (item.kind === 'product') {
      statements.push(
        ...stockOut(item.ref_id, item.qty, 'sale', newUuid(), { table: 'orders', id: oid })
      );
    }
    if (item.kind === 'partial_container' && item.container_id) {
      statements.push({ sql: "UPDATE containers SET remaining_volume = remaining_volume - $1, status = CASE WHEN remaining_volume - $1 <= 0 THEN 'empty' ELSE 'opened' END WHERE id = $2", params: [item.qty, item.container_id] });
      statements.push({ sql: 'INSERT INTO container_splits (container_id, sold_qty, order_id) VALUES ($1, $2, $3)', params: [item.container_id, item.qty, oid] });
    }
    if (item.kind === 'used_oil') {
      statements.push({ sql: 'UPDATE used_oil_drum SET current_litres = current_litres + $1 WHERE id = 1', params: [item.qty] });
      statements.push({ sql: "INSERT INTO used_oil_log (drum_id, litres, type, source_order_id) VALUES (1, $1, 'added', $2)", params: [item.qty, oid] });
    }
  }
  if (total > 0) {
    statements.push({ sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [total, paymentAccountId] });
    statements.push({ sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1, $2, 'in', $3)", params: [paymentAccountId, total, `Order #${oid}`] });
  }
  if (customerId) {
    statements.push({ sql: 'UPDATE customers SET last_visit_at = NOW() WHERE id = $1', params: [customerId] });
  }
  return statements;
}

function nextOid() {
  return Number(run('SELECT COALESCE(MAX(id), 0) + 1 AS oid FROM orders')[0].oid);
}

console.log('\nThe 2067 that survives v7: injectUuid appends a bare `?`, sqlx binds it to values[0]');

// ── Part 1 — the mechanism, pinned against sqlx's published binder ──────
check('MECH: sqlxBind maps a trailing bare `?` to values[0], not the last value', () => {
  const b = sqlxBind(
    'INSERT INTO order_items (order_id, kind, uuid) VALUES ($1, $2, ?)',
    [7, 'product', 'fresh-uuid-here']
  );
  assert(b.sql === 'INSERT INTO order_items (order_id, kind, uuid) VALUES (?, ?, ?)', 'placeholders must all become ?, got ' + b.sql);
  assert(JSON.stringify(b.params) === JSON.stringify([7, 'product', 7]),
    'the uuid slot must bind values[0] (= the order id), got ' + JSON.stringify(b.params));
});
check('MECH: sqlxBind maps $N to values[N-1], and a repeated $N to the same value', () => {
  const b = sqlxBind(
    "INSERT INTO orders (id, total, paid_amount, uuid) VALUES ($1, $2, $2, ?)",
    [9, 4000, 'fresh-uuid-here']
  );
  assert(JSON.stringify(b.params) === JSON.stringify([9, 4000, 4000, 9]),
    'expected [9, 4000, 4000, 9], got ' + JSON.stringify(b.params));
});

// ── Part 2 — the orphan seed, then schema init (the repair) ──────────────
// Tables first (no unique uuid index yet), then a v6-style partial commit:
// items for orders 7 and 8 whose orders never landed, uuids = the order id
// (what the old binding wrote), plus their outbox rows — and one healthy
// control line whose order DOES exist.
raw.exec(LOCAL_SCHEMA);
raw.exec(LOCAL_SCHEMA_2);
raw.exec(`CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_uuid TEXT NOT NULL,
  op TEXT NOT NULL DEFAULT 'insert',
  payload TEXT NOT NULL,
  queued_at TEXT DEFAULT (datetime('now')),
  attempts INTEGER DEFAULT 0,
  last_error TEXT
);`);
run("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status) VALUES (6, 1, 3, 1, 4000, 4000, 1, 'cash', 'completed')");
run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, uuid) VALUES (6, 'product', 1, 'GTX 4L', 1, 4000, 4000, 'real-uuid-control')");
run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, uuid) VALUES (7, 'product', 1, 'GTX 4L', 1, 4000, 4000, 7.0)");
run("INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, uuid) VALUES (8, 'product', 2, 'Engine Oil 1L', 1, 900, 900, 8.0)");
run("INSERT INTO sync_outbox (table_name, row_uuid, op, payload) VALUES ('order_items', 'real-uuid-control', 'insert', '{}')");
run("INSERT INTO sync_outbox (table_name, row_uuid, op, payload) VALUES ('order_items', '7.0', 'insert', '{}')");
run("INSERT INTO sync_outbox (table_name, row_uuid, op, payload) VALUES ('order_items', '8.0', 'insert', '{}')");

await ensureLocalSchema(db);

check('REPAIR: orphaned order_items rows have their bogus uuids NULLed at launch', () => {
  const rows = run('SELECT order_id, uuid FROM order_items ORDER BY order_id');
  assert(rows.length === 3, 'all three seeded lines must still be there, got ' + rows.length);
  assert(rows[0].uuid === 'real-uuid-control', 'the healthy line keeps its uuid, got ' + rows[0].uuid);
  assert(rows[1].uuid === null, 'orphan for missing order 7 must be NULLed, got ' + rows[1].uuid);
  assert(rows[2].uuid === null, 'orphan for missing order 8 must be NULLed, got ' + rows[2].uuid);
});
check('REPAIR: the orphans never sync — their outbox rows are dropped, the healthy one stays', () => {
  const left = run('SELECT row_uuid FROM sync_outbox WHERE table_name = \'order_items\' ORDER BY row_uuid');
  assert(left.length === 1 && left[0].row_uuid === 'real-uuid-control',
    'only the healthy outbox row may remain, got ' + JSON.stringify(left));
});
check('REPAIR: the unique index exists after the repair', () => {
  const idxs = run('PRAGMA index_list(order_items)').filter((ix) => ix.unique);
  const hit = idxs.some((ix) => run(`PRAGMA index_info(${ix.name})`).map((c) => c.name).join(',') === 'uuid');
  assert(hit, 'idx_order_items_uuid must exist after the repair');
});

// ── Part 3 — the sales, on the repaired DB ───────────────────────────────
// Seed the shop the realistic sale needs (literal VALUES, no injectUuid).
run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (1, 1, 'GTX 4L', '4L', 4000, 4000, 3600, 10, 10, 1)");
run("INSERT INTO products (id, shop_id, name, packing, price_walking, price_returning, price_wholesale, wholesale_min_qty, stock_qty, active) VALUES (2, 1, 'Engine Oil 1L', '1L', 900, 900, 800, 10, 20, 1)");
run("INSERT INTO services (id, shop_id, name, price, active) VALUES (1, 1, 'Oil Change', 500, 1)");
run("INSERT INTO customers (id, shop_id, name, phone, customer_type) VALUES (3, 1, 'Ahmed Raza', '03001234567', 'walking')");
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (5, 1, 1, 4, 2.5, 'opened', 1)");

const prodA = { id: 1, name: 'GTX 4L', packing: '4L' };
const prodB = { id: 2, name: 'Engine Oil 1L', packing: '1L' };
function twoItemCart() {
  return [
    { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
    { kind: 'product', ref_id: 2, name: 'Engine Oil 1L', qty: 1, unit_price: 900, line_total: 900, product: prodB },
  ];
}
function oneItemCart() {
  return [
    { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
  ];
}

// A fresh sale reusing the orphan's gap oid (7): the v6→v7 retry shape.
// The cart is freshly built — no cart-held uuids exist anywhere in this sim.
check('a fresh sale reusing the orphan gap oid (7) commits — no 2067 against the orphan', () => {
  assert(nextOid() === 7, 'the next oid must be the orphan gap 7, got ' + nextOid());
  runSaleTx(buildSaleStatements(7, oneItemCart(), 3, 1, 1, 4000, 0, '', null));
  assert(Number(run('SELECT COUNT(*) AS c FROM orders WHERE id = 7')[0].c) === 1, 'order 7 must land');
  const u = run('SELECT uuid FROM order_items WHERE order_id = 7 ORDER BY id DESC LIMIT 1')[0].uuid;
  assert(UUID_V4.test(u), 'the new line must carry a real v4 uuid, got ' + u);
});

check('a fresh two-item cart commits with two distinct real v4 uuids', () => {
  const oid = nextOid();
  runSaleTx(buildSaleStatements(oid, twoItemCart(), 3, 1, 1, 4900, 0, '', null));
  const rows = run('SELECT uuid FROM order_items WHERE order_id = ? AND uuid IS NOT NULL', [oid]);
  assert(rows.length === 2, 'two lines expected, got ' + rows.length);
  assert(rows.every((r) => UUID_V4.test(r.uuid)), 'every line must carry a real v4 uuid, got ' + JSON.stringify(rows));
  assert(new Set(rows.map((r) => r.uuid)).size === 2, 'the two uuids must differ');
  assert(rows.every((r) => r.uuid !== String(oid)), 'no line uuid may equal the order id');
  assert(Number(run('SELECT stock_qty FROM products WHERE id = 1')[0].stock_qty) === 8, 'stock must drop by exactly the two sales so far');
});

check('a second single-item sale on the same account commits — no 2067 on account_transactions.uuid', () => {
  const oid = nextOid();
  runSaleTx(buildSaleStatements(oid, oneItemCart(), 3, 1, 1, 4000, 0, '', null));
  const u = run('SELECT uuid FROM account_transactions WHERE reference = ?', [`Order #${oid}`])[0].uuid;
  assert(UUID_V4.test(u), 'the account row must carry a real v4 uuid, got ' + u);
  assert(Number(run('SELECT COUNT(*) AS c FROM account_transactions WHERE uuid = ?', ['1.0'])[0].c) === 0, 'no account row may carry the bogus uuid "1.0"');
});

check('two vehicles for the same customer both insert with distinct real uuids', () => {
  const v1 = runExecute(
    'INSERT INTO vehicles (customer_id, registration, make, model, model_year, color, condition, mileage, oil_capacity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [3, 'ABC-123', 'Toyota', 'Corolla', '2019', 'White', 'Good', 45000, 3.5]
  );
  const v2 = runExecute(
    'INSERT INTO vehicles (customer_id, registration, make, model, model_year, color, condition, mileage, oil_capacity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [3, 'XYZ-789', 'Honda', 'Civic', '2020', 'Black', 'Good', 30000, 3.5]
  );
  assert(v1[0]?.id && v2[0]?.id && v1[0].id !== v2[0].id, 'both vehicles must land with distinct ids');
  const uuids = run('SELECT uuid FROM vehicles WHERE customer_id = 3 ORDER BY id').map((r) => r.uuid);
  assert(uuids.length === 2 && uuids.every((u) => UUID_V4.test(u)) && new Set(uuids).size === 2,
    'both vehicles must carry distinct real v4 uuids, got ' + JSON.stringify(uuids));
});

check('the same product twice in one cart commits with distinct uuids', () => {
  const oid = nextOid();
  const cart = [
    { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
    { kind: 'product', ref_id: 1, name: 'GTX 4L', qty: 1, unit_price: 4000, line_total: 4000, product: prodA },
  ];
  runSaleTx(buildSaleStatements(oid, cart, 3, 1, 1, 8000, 0, '', null));
  const rows = run('SELECT uuid FROM order_items WHERE order_id = ?', [oid]);
  assert(rows.length === 2 && new Set(rows.map((r) => r.uuid)).size === 2, 'the two lines must carry distinct uuids');
});

check('twenty sales in a row commit with globally distinct order_items uuids', () => {
  for (let i = 0; i < 20; i++) {
    const oid = nextOid();
    runSaleTx(buildSaleStatements(oid, twoItemCart(), 3, 1, 1, 4900, 0, '', null));
  }
  const dupes = run('SELECT uuid, COUNT(*) AS c FROM order_items WHERE uuid IS NOT NULL GROUP BY uuid HAVING c > 1');
  assert(dupes.length === 0, 'no uuid may repeat across all sales, got ' + JSON.stringify(dupes));
  const nonV4 = run("SELECT uuid FROM order_items WHERE uuid IS NOT NULL AND uuid != 'real-uuid-control' AND uuid NOT GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-*'");
  assert(nonV4.length === 0, 'every stored uuid must be v4-shaped, got ' + JSON.stringify(nonV4));
});

// ── Part 3b — leftover drawdown: a drained container leaves the picker ───
// Umar 2026-11-25 ~17:51 PKT: "check if the containers entry get excluded
// from the container stock when the left over is used." The picker query is
// the exact one from POSSearch.tsx (status IN ('opened','full') AND
// remaining_volume > 0); the drawdown is completeSale's partial_container
// branch (UPDATE containers … status 'empty' at 0). Two containers are
// seeded below: id 5 holds 0.5L, id 6 holds 2.5L.
run("INSERT INTO containers (id, shop_id, product_id, original_volume, remaining_volume, status, source_order_id) VALUES (6, 1, 1, 4, 0.5, 'opened', 1)");
const PICKER_SQL = `SELECT c.id, c.product_id, c.barcode, c.remaining_volume, c.status, c.source_order_id, p.name as product_name, p.packing, p.price_walking, p.price_returning, p.price_wholesale, p.wholesale_min_qty, (SELECT oi.unit_price FROM order_items oi WHERE oi.order_id = c.source_order_id AND oi.ref_id = c.product_id AND oi.kind = 'product' ORDER BY oi.id LIMIT 1) AS source_unit_price, (SELECT oi.capacity FROM order_items oi WHERE oi.order_id = c.source_order_id AND oi.ref_id = c.product_id AND oi.kind = 'product' ORDER BY oi.id LIMIT 1) AS source_capacity, (SELECT oi.billed_by_capacity FROM order_items oi WHERE oi.order_id = c.source_order_id AND oi.ref_id = c.product_id AND oi.kind = 'product' ORDER BY oi.id LIMIT 1) AS source_billed_by_capacity FROM containers c JOIN products p ON c.product_id = p.id WHERE c.status IN ('opened','full') AND c.remaining_volume > 0 AND LOWER(p.name) LIKE $1 ORDER BY c.opened_at DESC LIMIT 5`;
function pickerRows(q) {
  return run(PICKER_SQL, [q]);
}

check('a container fully drawn (0.5L from 0.5L left) is excluded from the picker afterwards', () => {
  assert(pickerRows('%gtx%').some((r) => r.id === 6), 'container 6 (0.5L) must be offered before the draw');
  const oid = nextOid();
  const cart = [{ kind: 'partial_container', ref_id: 6, name: 'GTX 4L (0.5L left)', qty: 0.5, unit_price: 1000, line_total: 500, container_id: 6, max_qty: 0.5 }];
  runSaleTx(buildSaleStatements(oid, cart, 3, 1, 1, 500, 0, '', null));
  const c = run('SELECT remaining_volume, status FROM containers WHERE id = 6')[0];
  assert(Number(c.remaining_volume) === 0, 'the container must be drained to 0, got ' + c.remaining_volume);
  assert(c.status === 'empty', 'the drained container must be empty, got ' + c.status);
  assert(!pickerRows('%gtx%').some((r) => r.id === 6), 'the drained container must NOT be offered again');
  const split = run('SELECT container_id, sold_qty, order_id FROM container_splits WHERE container_id = 6');
  assert(split.length === 1 && Number(split[0].sold_qty) === 0.5 && split[0].order_id === oid, 'the draw must be recorded in container_splits');
});

check('a container partially drawn (0.5L from 2.5L left) stays offered with the reduced volume', () => {
  const oid = nextOid();
  const cart = [{ kind: 'partial_container', ref_id: 5, name: 'GTX 4L (2.5L left)', qty: 0.5, unit_price: 1000, line_total: 500, container_id: 5, max_qty: 2.5 }];
  runSaleTx(buildSaleStatements(oid, cart, 3, 1, 1, 500, 0, '', null));
  const c = run('SELECT remaining_volume, status FROM containers WHERE id = 5')[0];
  assert(Number(c.remaining_volume) === 2, 'the container must hold 2.0L after the draw, got ' + c.remaining_volume);
  assert(c.status === 'opened', 'the partly drawn container stays opened, got ' + c.status);
  const row = pickerRows('%gtx%').find((r) => r.id === 5);
  assert(row && Number(row.remaining_volume) === 2, 'the picker must show the reduced 2.0L, got ' + JSON.stringify(row));
});

// ── Part 4 — injectUuid's contract, pinned ───────────────────────────────
check('injectUuid appends a NUMBERED placeholder ($K), never a bare `?`', () => {
  const r = injectUuid('INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)', ['x'], SYNC_TABLES);
  assert(r !== null, 'injectUuid must fire on the sale line');
  assert(r.sql.endsWith(', $14)'), 'the uuid placeholder must be $14, got tail: ' + r.sql.slice(-20));
  assert(!/,\s*\?\)/.test(r.sql), 'no bare `?` may remain in the statement');
  assert(r.params.length === 2 && UUID_V4.test(r.params[1]), 'the appended param must be the fresh v4 uuid');
});
check('injectUuid numbers from the highest $N even when a placeholder repeats', () => {
  const r = injectUuid("INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, vehicle_id, mileage, notes, created_at) VALUES ($1, 1, $2, $3, $4, $4, $5, 'cash', 'completed', $6, $7, $8, NOW())", ['x'], SYNC_TABLES);
  assert(r !== null && r.sql.endsWith(', $9)'), 'the uuid placeholder must be $9 ($4 repeats, highest is $8), got tail: ' + (r?.sql ?? 'null').slice(-20));
});
check('injectUuid on a placeholder-free INSERT appends $1', () => {
  const r = injectUuid("INSERT INTO products (name) VALUES ('Tea')", [], SYNC_TABLES);
  assert(r !== null && r.sql.endsWith(', $1)'), 'the uuid placeholder must be $1, got: ' + (r?.sql ?? 'null'));
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
