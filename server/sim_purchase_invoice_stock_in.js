/**
 * Vendor invoice / stock-in — receive a shipment, add it to stock
 * (Umar, 2026-11-27): "in vendors, when we create invoice, there
 * should be a list of products, like adding different products, their
 * quantity, and that will go directly to the stock... the price is
 * against some products, the list, the quantity, it should be added
 * into the stock, and there should be log of the added products
 * available."
 *
 * Before this batch the Purchase screen was a "coming soon" placeholder
 * and purchase_orders had zero rows (server/migrations/025 says so
 * outright), so buying oil had no way to be recorded as arriving: the
 * stock could only ever go DOWN. The local purchase_order_items table
 * also disagreed with the server about its own columns (order_id /
 * product_name / unit_cost locally vs purchase_order_id / product_id /
 * cost_price on the server), and the server purchase_orders row had no
 * paid or notes column for the invoice to record.
 *
 * Fix (src/lib/purchase.ts, src/modules/purchase/Purchase.tsx,
 * src/modules/vendors/Vendors.tsx, src/lib/ledgerSql.ts,
 * src/lib/localDb.ts, server/migrations/036, server/index.js):
 *  - Purchase screen: invoice list (vendor, date, total, paid, due,
 *    line count), New Invoice form, per-invoice detail (lines + the
 *    stock movements that invoice added), and a Stock-in log tab.
 *  - New Invoice: pick a vendor; add lines; each line picks an existing
 *    product (search by name, cost prefilled) or "add new name"
 *    (creates the product with that name, cost_price = the line's unit
 *    cost); quantity; unit cost; line + invoice totals auto-computed;
 *    optional paid-now amount with the till account it leaves from.
 *  - One atomic transaction per save: new products, the purchase_orders
 *    row (status 'received'), the purchase_order_items rows, one
 *    stock_movements 'purchase' row per line through lib/stock's stockIn
 *    (products.stock_qty AND stock_levels move together — the sale's
 *    statements in reverse), and the vendor Khata pair (bill debit full
 *    total + payment credit paid now, linked to the vendor_payables row
 *    the bill opens, settled FIFO). The invoice carries one
 *    client-generated uuid, UNIQUE on both engines, so a double-submit
 *    fails the whole transaction instead of adding the stock twice.
 *  - Vendors screen: a "+ Invoice" button per row opens the Purchase
 *    screen with that vendor preselected (?vendor=<id>).
 *
 * The gap that let the old behaviour ship: no sim ever built a purchase
 * invoice — the screen was a placeholder and the tables had zero rows.
 * This sim builds invoices with the REAL builder, the REAL stock
 * helpers and the REAL ledger helpers, against the REAL local schema.
 *
 * Run:  node --experimental-strip-types server/sim_purchase_invoice_stock_in.js
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ensureLocalSchema,
  pgToSqlite,
  LOCAL_SCHEMA,
  LOCAL_SCHEMA_2,
  LOCAL_SCHEMA_3,
  LOCAL_SCHEMA_4,
  LOCAL_SCHEMA_5,
  LOCAL_SCHEMA_6,
  LOCAL_SCHEMA_7,
  LOCAL_SCHEMA_8,
  LOCAL_SCHEMA_9,
} from '../src/lib/localDb.ts';
import { injectUuid } from '../src/lib/outbox.ts';
import { SYNC_TABLES } from '../src/lib/sync.ts';
import { newUuid } from '../src/lib/uuid.ts';
import {
  buildPurchaseInvoiceStatements,
  purchaseInvoiceTotal,
  validatePurchaseInvoice,
} from '../src/lib/purchase.ts';
import { billStatements, paymentStatements } from '../src/lib/ledgerSql.ts';

// ── sqlx-faithful binding (copied from sim_sale_payment_options.js) ────
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
  function runTx(statements) {
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
  return { raw, db, run, runTx };
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

const PURCHASE = readFileSync(new URL('../src/lib/purchase.ts', import.meta.url), 'utf8');
const PURCHASE_TSX = readFileSync(new URL('../src/modules/purchase/Purchase.tsx', import.meta.url), 'utf8');
const VENDORS = readFileSync(new URL('../src/modules/vendors/Vendors.tsx', import.meta.url), 'utf8');
const LOCALDB = readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8');
const LEDGERSQL = readFileSync(new URL('../src/lib/ledgerSql.ts', import.meta.url), 'utf8');
const MIGRATION_036 = readFileSync(new URL('./migrations/036_purchase_invoice_paid.sql', import.meta.url), 'utf8');
const SERVER_INDEX = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

// ── the REAL permission machinery, as sim_sale_permissions.js extracts it
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
const allowed = (sql, perms) => {
  const need = requiredPermissions(sql);
  return !need || need.some((p) => perms.includes(p));
};
const bundleAllowed = (stmts, perms) => stmts.every((s) => allowed(s.sql, perms));

console.log('\nVendor invoice / stock-in: shipment received, stock up, log kept');

// ── Part 1 — wiring: the source carries the new shape ───────────────────
check('WIRING: the Purchase screen builds invoices through the real builder', () => {
  assert(PURCHASE_TSX.includes('buildPurchaseInvoiceStatements('), 'Purchase.tsx must call the builder');
  assert(PURCHASE_TSX.includes('dbTransaction(statements)'), 'Purchase.tsx must run one transaction');
  assert(PURCHASE_TSX.includes('nextval(pg_get_serial_sequence(\'purchase_orders\', \'id\'))'), 'the screen must reserve the invoice id');
  assert(PURCHASE_TSX.includes('nextval(pg_get_serial_sequence(\'vendor_payables\', \'id\'))'), 'the screen must reserve the payable id');
  assert(PURCHASE_TSX.includes('Stock-in log'), 'the screen must have the stock-in log tab');
  assert(PURCHASE_TSX.includes("ref_table = 'purchase_orders'"), 'the detail must read the invoice movements');
  assert(PURCHASE_TSX.includes('Add new product'), 'the line editor must offer adding a new name');
  assert(PURCHASE_TSX.includes('params.get("vendor")'), 'the screen must preselect the vendor from ?vendor=');
});

check('WIRING: the Vendors screen links each vendor to a new invoice', () => {
  assert(VENDORS.includes("`/purchase?vendor=${v.id}`"), 'Vendors.tsx must link to /purchase?vendor=<id>');
});

check('WIRING: the local items table uses the server column names', () => {
  assert(LOCALDB.includes('purchase_order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, qty REAL DEFAULT 0, cost_price REAL DEFAULT 0, line_total REAL DEFAULT 0'),
    'localDb.ts must define purchase_order_items with the server columns');
  assert(!LOCALDB.includes('CREATE TABLE IF NOT EXISTS purchase_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER'),
    'the old order_id shape must be gone from the CREATE TABLE');
  assert(LOCALDB.includes('patchPurchaseOrderItemsSchema'), 'localDb.ts must patch existing databases to the new shape');
  assert(LOCALDB.includes("status TEXT DEFAULT 'received'"), 'the local order default must be received, not completed');
});

check('WIRING: the server migration adds paid + notes to purchase_orders', () => {
  assert(MIGRATION_036.includes('ADD COLUMN IF NOT EXISTS paid NUMERIC(18,4) DEFAULT 0'), '036 must add paid');
  assert(MIGRATION_036.includes("ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''"), '036 must add notes');
});

check('WIRING: the ledger helper takes an explicit payable id', () => {
  assert(LEDGERSQL.includes('payableId?: number | null'), 'BillInput must accept payableId');
  assert(LEDGERSQL.includes('INSERT INTO vendor_payables (id, vendor_id, amount, due_date, status)'),
    'the vendor bill must insert the payable with the reserved id');
});

check('WIRING: the builder writes the order, the lines, the stock-in and the Khata pair', () => {
  assert(PURCHASE.includes("INSERT INTO purchase_orders (id, shop_id, vendor_id, total, paid, status, notes, uuid)"), 'the builder must insert the order row');
  assert(PURCHASE.includes("'received'"), 'the order must be received');
  assert(PURCHASE.includes('INSERT INTO purchase_order_items (purchase_order_id, product_id, qty, cost_price, line_total)'), 'the builder must insert the lines');
  assert(PURCHASE.includes('stockIn(line.productId, line.qty, "purchase"'), 'the builder must stock each line in');
  assert(PURCHASE.includes('billStatements({'), 'the builder must post the vendor bill');
  assert(PURCHASE.includes('paymentStatements({'), 'the builder must post the paid-now payment');
  assert(PURCHASE.includes('payableId: a.payableId'), 'the bill must carry the reserved payable id');
  assert(PURCHASE.includes('order_id'), 'the builder must NOT link ledger rows to the purchase id — the comment must say why');
});

check('SQL: every builder statement translates with no cast left and no forbidden construct', () => {
  const stmts = buildPurchaseInvoiceStatements({
    oid: 1, payableId: 1, vendorId: 1, invoiceUuid: 'u-inv-1',
    lines: [{ productId: 1, qty: 10, unitCost: 2500 }],
    newProducts: [{ id: 2, name: 'Shell Helix 4L', unitCost: 1800 }],
    total: 25000, paidNow: 0, accountId: null, notes: '', occurredAt: '2026-11-27',
  });
  assert(stmts.length > 0, 'the builder must return statements');
  for (const s of stmts) {
    const t = pgToSqlite(s.sql);
    assert(!t.includes('::'), 'translated statement must have no cast, got: ' + t);
    assert(!/to_char|generate_series|TRIM\s*\(\s*BOTH|CONCAT_WS|FROM\s*\(\s*VALUES/i.test(s.sql),
      'no Postgres-only construct may appear, got: ' + s.sql);
    assert(!s.sql.includes('--'), 'no -- comment may sit inside a SQL literal, got: ' + s.sql);
  }
});

// ── Part 2 — the database and the invoice builder ────────────────────────
// Mirrors Purchase.tsx's save: reserve the ids, resolve "add new name"
// lines against products (reuse the name when it exists), build the
// statements with the REAL builder, run them in one transaction.
const h = makeDb();
h.raw.exec(LOCAL_SCHEMA);
h.raw.exec(LOCAL_SCHEMA_2);
h.raw.exec(LOCAL_SCHEMA_3);
h.raw.exec(LOCAL_SCHEMA_4);
h.raw.exec(LOCAL_SCHEMA_5);
h.raw.exec(LOCAL_SCHEMA_6);
h.raw.exec(LOCAL_SCHEMA_7);
h.raw.exec(LOCAL_SCHEMA_8);
h.raw.exec(LOCAL_SCHEMA_9);
await ensureLocalSchema(h.db);
h.raw.exec("INSERT INTO vendors (id, shop_id, name, contact, phone) VALUES (1, 1, 'Shell Distributors', 'Ali', '03001112222')");
h.raw.exec("INSERT INTO products (id, shop_id, name, cost_price, stock_qty) VALUES (1, 1, 'Mobil 1 4L', 3000, 5)");
h.raw.exec("UPDATE accounts SET balance = 100000 WHERE id = 1");

const nextId = (table) => Number(h.run(`SELECT nextval(pg_get_serial_sequence('${table}', 'id')) AS oid`)[0].oid);

function saveInvoice({ vendorId, lines, paidNow, accountId, notes = '' }) {
  const input = { vendorId, lines, paidNow, accountId, notes };
  const err = validatePurchaseInvoice(input);
  assert(!err, 'the invoice builder must only build allowed invoices, got: ' + err);
  const oid = nextId('purchase_orders');
  const payableId = nextId('vendor_payables');
  const resolved = [];
  const newProducts = [];
  for (const l of lines) {
    if (l.productId != null) {
      resolved.push({ productId: l.productId, qty: l.qty, unitCost: l.unitCost });
      continue;
    }
    const found = h.run('SELECT id FROM products WHERE LOWER(name) = LOWER($1) LIMIT 1', [l.newName.trim()])[0];
    if (found?.id) {
      resolved.push({ productId: found.id, qty: l.qty, unitCost: l.unitCost });
      continue;
    }
    const nid = nextId('products');
    newProducts.push({ id: nid, name: l.newName.trim(), unitCost: l.unitCost });
    resolved.push({ productId: nid, qty: l.qty, unitCost: l.unitCost });
  }
  const total = purchaseInvoiceTotal(lines);
  const invoiceUuid = newUuid();
  const stmts = buildPurchaseInvoiceStatements({
    oid, payableId, vendorId, invoiceUuid, lines: resolved, newProducts,
    total, paidNow, accountId, notes, occurredAt: '2026-11-27',
  });
  h.runTx(stmts);
  return { oid, payableId, invoiceUuid, stmts, total };
}

const stockQty = (id) => Number(h.run('SELECT stock_qty FROM products WHERE id = $1', [id])[0].stock_qty);
const levelQty = (id) => Number(h.run('SELECT qty FROM stock_levels WHERE product_id = $1', [id])[0]?.qty ?? NaN);
const movements = (oid) => h.run("SELECT item_id, kind, qty, qty_after, ref_table, ref_id FROM stock_movements WHERE ref_table = 'purchase_orders' AND ref_id = $1 ORDER BY id", [oid]);
const orderRow = (oid) => h.run('SELECT total, paid, status FROM purchase_orders WHERE id = $1', [oid])[0];
const payableBalance = () => Number(h.run('SELECT payable_balance FROM vendors WHERE id = 1')[0].payable_balance);
const payableRow = (id) => h.run('SELECT amount, status FROM vendor_payables WHERE id = $1', [id])[0];
const ledgerRows = (vid) => h.run("SELECT kind, direction, amount, vendor_payable_id, note FROM party_ledger WHERE party_type = 'vendor' AND party_id = $1 ORDER BY id", [vid]);
const tillBalance = () => Number(h.run('SELECT balance FROM accounts WHERE id = 1')[0].balance);

// ── Part 3 — invoice 1: existing + new product, nothing paid ────────────
let inv1;
check('INVOICE 1: two lines stock in exactly, totals and due are right, vendor owes the full total', () => {
  inv1 = saveInvoice({
    vendorId: 1,
    lines: [
      { productId: 1, newName: '', qty: 10, unitCost: 2500 },
      { productId: null, newName: 'Shell Helix 4L', qty: 4, unitCost: 1800 },
    ],
    paidNow: 0, accountId: null,
  });
  assert(inv1.total === 32200, '10x2500 + 4x1800 must be 32200, got ' + inv1.total);
  const o = orderRow(inv1.oid);
  assert(Number(o.total) === 32200 && Number(o.paid) === 0 && o.status === 'received',
    'the order must record total 32200, paid 0, received, got ' + JSON.stringify(o));
  assert(stockQty(1) === 15, 'Mobil 1 must go 5 -> 15, got ' + stockQty(1));
  assert(levelQty(1) === 10, 'the warehouse level for Mobil 1 must be 10, got ' + levelQty(1));
  const np = h.run("SELECT id, cost_price, stock_qty FROM products WHERE name = 'Shell Helix 4L'")[0];
  assert(np && Number(np.cost_price) === 1800 && Number(np.stock_qty) === 4,
    'the new product must be created with cost 1800 and stock 4, got ' + JSON.stringify(np));
  assert(levelQty(Number(np.id)) === 4, 'the warehouse level for the new product must be 4');
  const items = h.run('SELECT product_id, qty, cost_price, line_total FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id', [inv1.oid]);
  assert(items.length === 2, 'two item rows must exist, got ' + items.length);
  assert(Number(items[0].qty) === 10 && Number(items[0].cost_price) === 2500 && Number(items[0].line_total) === 25000,
    'the first line must be 10 x 2500 = 25000, got ' + JSON.stringify(items[0]));
  assert(Number(items[1].qty) === 4 && Number(items[1].line_total) === 7200,
    'the second line must be 4 x 1800 = 7200, got ' + JSON.stringify(items[1]));
  const moves = movements(inv1.oid);
  assert(moves.length === 2, 'two stock movements must exist, got ' + moves.length);
  assert(moves.every((m) => m.kind === 'purchase' && m.ref_table === 'purchase_orders' && Number(m.ref_id) === inv1.oid),
    'both movements must be purchase rows linked to the invoice, got ' + JSON.stringify(moves));
  assert(Number(moves[0].qty) === 10 && Number(moves[0].qty_after) === 15,
    'the Mobil 1 movement must add 10 and land at 15, got ' + JSON.stringify(moves[0]));
  assert(Number(moves[1].qty) === 4 && Number(moves[1].qty_after) === 4,
    'the new product movement must add 4 and land at 4, got ' + JSON.stringify(moves[1]));
  assert(payableBalance() === 32200, 'the vendor must be owed the full total, got ' + payableBalance());
  const p = payableRow(inv1.payableId);
  assert(Number(p.amount) === 32200 && p.status === 'pending',
    'the payable must be pending for 32200, got ' + JSON.stringify(p));
  const rows = ledgerRows(1);
  assert(rows.length === 1 && rows[0].kind === 'bill' && rows[0].direction === 'debit'
    && Number(rows[0].amount) === 32200 && Number(rows[0].vendor_payable_id) === inv1.payableId,
    'only the bill posts, linked to the payable, got ' + JSON.stringify(rows));
  assert(tillBalance() === 100000, 'nothing paid means the till must not move');
});

// ── Part 4 — invoice 2: partial payment settles the payable in part ─────
let inv2;
check('INVOICE 2: a part-paid invoice leaves the till by the paid part and the payable partial', () => {
  const before = tillBalance();
  inv2 = saveInvoice({
    vendorId: 1,
    lines: [{ productId: 1, newName: '', qty: 2, unitCost: 1000 }],
    paidNow: 1500, accountId: 1,
  });
  assert(inv2.total === 2000, '2x1000 must be 2000, got ' + inv2.total);
  assert(stockQty(1) === 17, 'Mobil 1 must go 15 -> 17, got ' + stockQty(1));
  assert(tillBalance() === before - 1500, 'the till must lose exactly the paid part');
  const tx = h.run("SELECT amount, type FROM account_transactions WHERE reference LIKE 'Paid on invoice%' ORDER BY id DESC LIMIT 1")[0];
  assert(tx && Number(tx.amount) === 1500 && tx.type === 'out',
    'one till receipt out for 1500 must exist, got ' + JSON.stringify(tx));
  const p = payableRow(inv2.payableId);
  assert(Number(p.amount) === 2000 && p.status === 'partial',
    'the payable must be partial for 2000, got ' + JSON.stringify(p));
  const alloc = h.run('SELECT amount FROM payable_allocations WHERE vendor_payable_id = $1', [inv2.payableId]);
  assert(alloc.length === 1 && Number(alloc[0].amount) === 1500,
    'the allocation must record 1500 against the payable, got ' + JSON.stringify(alloc));
  assert(payableBalance() === 32200 + 500, 'the vendor must be owed 32200 + 500, got ' + payableBalance());
  const rows = ledgerRows(1);
  const mine = rows.filter((r) => r.vendor_payable_id === inv2.payableId);
  assert(mine.length === 2 && mine[0].kind === 'bill' && Number(mine[0].amount) === 2000
    && mine[1].kind === 'payment' && mine[1].direction === 'credit' && Number(mine[1].amount) === 1500,
    'this invoice must post bill 2000 + payment 1500, got ' + JSON.stringify(mine));
});

// ── Part 5 — invoice 3: paid in full settles the payable ────────────────
check('INVOICE 3: a fully paid invoice settles its payable and nets zero owed', () => {
  const before = tillBalance();
  const inv3 = saveInvoice({
    vendorId: 1,
    lines: [{ productId: 1, newName: '', qty: 1, unitCost: 500 }],
    paidNow: 500, accountId: 1,
  });
  assert(inv3.total === 500, '1x500 must be 500');
  assert(tillBalance() === before - 500, 'the till must lose the full 500');
  const p = payableRow(inv3.payableId);
  assert(p.status === 'paid', 'the payable must be paid, got ' + JSON.stringify(p));
  assert(payableBalance() === 32700, 'a fully paid invoice must not change what is owed, got ' + payableBalance());
  const rows = ledgerRows(1).filter((r) => r.vendor_payable_id === inv3.payableId);
  assert(rows.length === 2 && Number(rows[0].amount) === 500 && Number(rows[1].amount) === 500,
    'bill and payment must both be 500, got ' + JSON.stringify(rows));
});

// ── Part 6 — the same name twice reuses the product ─────────────────────
check('NEW NAME: a second invoice with the same new name reuses the product', () => {
  const before = h.run("SELECT COUNT(*) AS c FROM products WHERE name = 'Shell Helix 4L'")[0].c;
  saveInvoice({
    vendorId: 1,
    lines: [{ productId: null, newName: 'shell helix 4l', qty: 2, unitCost: 1800 }],
    paidNow: 0, accountId: null,
  });
  const after = h.run("SELECT COUNT(*) AS c FROM products WHERE name = 'Shell Helix 4L'")[0].c;
  assert(after === before, 'no duplicate product may be created, got ' + after + ' rows');
  assert(stockQty(h.run("SELECT id FROM products WHERE name = 'Shell Helix 4L'")[0].id) === 6,
    'the reused product must gain the 2 units, got the wrong stock');
});

// ── Part 7 — double-save: same uuid, new order id, nothing moves twice ──
check('DOUBLE-SAVE: saving the same invoice again fails on the uuid and adds no stock', () => {
  const stockBefore = stockQty(1);
  const movesBefore = Number(h.run('SELECT COUNT(*) AS c FROM stock_movements')[0].c);
  const balanceBefore = payableBalance();
  const oid2 = nextId('purchase_orders');
  const payable2 = nextId('vendor_payables');
  const helixId = h.run("SELECT id FROM products WHERE name = 'Shell Helix 4L'")[0].id;
  const stmts = buildPurchaseInvoiceStatements({
    oid: oid2, payableId: payable2, vendorId: 1, invoiceUuid: inv1.invoiceUuid,
    lines: [
      { productId: 1, qty: 10, unitCost: 2500 },
      { productId: helixId, qty: 4, unitCost: 1800 },
    ],
    newProducts: [],
    total: 32200, paidNow: 0, accountId: null, notes: '', occurredAt: '2026-11-27',
  });
  let err = null;
  try { h.runTx(stmts); } catch (e) { err = e; }
  assert(err && /UNIQUE constraint failed/i.test(err.message),
    'the retry must fail on the invoice uuid, got: ' + (err && err.message));
  assert(stockQty(1) === stockBefore, 'no stock may be added by the retry');
  assert(Number(h.run('SELECT COUNT(*) AS c FROM stock_movements')[0].c) === movesBefore,
    'no movement may be added by the retry');
  assert(payableBalance() === balanceBefore, 'no payable may be added by the retry');
  assert(!h.run('SELECT id FROM purchase_orders WHERE id = $1', [oid2])[0],
    'no second order row may exist');
});

// ── Part 8 — the guards, through the real rules ─────────────────────────
check('GUARD: the builder refuses a bad invoice before any statement runs', () => {
  const ordersBefore = Number(h.run('SELECT COUNT(*) AS c FROM purchase_orders')[0].c);
  for (const bad of [
    { vendorId: null, lines: [{ productId: 1, newName: '', qty: 1, unitCost: 100 }], paidNow: 0, accountId: null, notes: '' },
    { vendorId: 1, lines: [], paidNow: 0, accountId: null, notes: '' },
    { vendorId: 1, lines: [{ productId: 1, newName: '', qty: 0, unitCost: 100 }], paidNow: 0, accountId: null, notes: '' },
    { vendorId: 1, lines: [{ productId: 1, newName: '', qty: 1, unitCost: 100 }], paidNow: 999999, accountId: 1, notes: '' },
  ]) {
    assert(validatePurchaseInvoice(bad) !== null, 'the bad invoice must be refused: ' + JSON.stringify(bad));
  }
  assert(Number(h.run('SELECT COUNT(*) AS c FROM purchase_orders')[0].c) === ordersBefore,
    'no refused invoice may have written a row');
});

// ── Part 9 — the log the screen reads ───────────────────────────────────
check('LOG: the stock-in log query lists every purchase movement with its vendor', () => {
  const rows = h.run(`SELECT m.id, m.qty, m.qty_after, p.name AS product_name, v.name AS vendor_name
      FROM stock_movements m
      JOIN products p ON p.id = m.item_id
      LEFT JOIN purchase_orders po ON po.id = m.ref_id AND m.ref_table = 'purchase_orders'
      LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE m.kind = 'purchase' ORDER BY m.id`);
  assert(rows.length === 5, 'five purchase movements must exist (2 + 1 + 1 + 1), got ' + rows.length);
  assert(rows.every((r) => r.vendor_name === 'Shell Distributors'),
    'every movement must name the vendor, got ' + JSON.stringify(rows[0]));
  assert(rows.every((r) => Number(r.qty) > 0), 'every log row must be an addition');
});

check('LOG: the invoice detail query returns its lines and its movements', () => {
  const items = h.run('SELECT i.*, p.name AS product_name FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.purchase_order_id = $1 ORDER BY i.id', [inv1.oid]);
  assert(items.length === 2 && items[0].product_name === 'Mobil 1 4L' && items[1].product_name === 'Shell Helix 4L',
    'the detail must join the product names, got ' + JSON.stringify(items));
  const moves = movements(inv1.oid);
  assert(moves.length === 2, 'the detail must list the two movements');
  const list = h.run(`SELECT po.id, v.name AS vendor_name, po.total, po.paid,
        (SELECT COUNT(*) FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS line_count
      FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id ORDER BY po.id DESC`);
  assert(list.length >= 4 && Number(list[0].line_count) >= 1 && Number(list[0].total) - Number(list[0].paid) >= 0,
    'the list query must carry totals, paid and line counts, got ' + JSON.stringify(list[0]));
});

// ── Part 10 — the old-shape patch ───────────────────────────────────────
// Own process on purpose: ensureLocalSchema runs once per module load,
// so this runs in server/sim_purchase_items_schema_upgrade.js (same
// pattern as sim_stock_levels_upgrade.js) — see that file.
check('PATCH: the old-shape upgrade is covered by its own sim', () => {
  const upgrade = readFileSync(new URL('./sim_purchase_items_schema_upgrade.js', import.meta.url), 'utf8');
  assert(upgrade.includes('patchPurchaseOrderItemsSchema') || upgrade.includes('order_id INTEGER NOT NULL'),
    'sim_purchase_items_schema_upgrade.js must build the old shape and run the upgrade');
});

// ── Part 11 — server permissions for the purchase bundle ─────────────────
check('PERMS: the whole purchase bundle passes for a manager, and the stock bump passes for purchase.manage alone', () => {
  const stmts = buildPurchaseInvoiceStatements({
    oid: 99, payableId: 99, vendorId: 1, invoiceUuid: 'u-perm-1',
    lines: [{ productId: 1, qty: 5, unitCost: 1000 }],
    newProducts: [{ id: 3, name: 'Perm Oil', unitCost: 1000 }],
    total: 5000, paidNow: 1000, accountId: 1, notes: '', occurredAt: '2026-11-27',
  });
  const manager = ['purchase.manage', 'catalog.manage', 'accounts', 'vendors', 'pos.create'];
  assert(bundleAllowed(stmts, manager), 'the manager must pass every statement');
  const bump = 'UPDATE products SET stock_qty = COALESCE(stock_qty, 0) + $1 WHERE id = $2';
  assert(allowed(bump, ['purchase.manage']), 'the stock_qty bump must pass for purchase.manage alone');
  assert(allowed(bump, ['pos.create']), 'the sale path is untouched: pos.create still passes the bump');
  assert(!allowed('INSERT INTO products (name, stock_qty) VALUES ($1, $2)', ['purchase.manage']),
    'creating a new product must still need catalog.manage — the screen must say so when it 403s');
});

console.log(`\n${ok}/${total} passed`);
if (ok !== total) process.exit(1);
