/**
 * VPS sale as worker1 — the "Permission denied" on completing a sale
 * (2026-11-24, live api log).
 *
 * worker1 holds exactly [dashboard, customers, pos.create, sales_history].
 * The sale bundle in src/modules/pos/POSCart.tsx completeSale writes four
 * tables that needed catalog.manage and nothing else:
 *  - the stock cache bump `UPDATE products SET stock_qty = ...`
 *  - containers (shelved leftover oil), container_splits (partial-container
 *    drawdown), used_oil_log / used_oil_drum (used-oil drop-off)
 *
 * The fix, in server/index.js requiredPermissions / WRITE_PERMISSIONS:
 *  - a products UPDATE that assigns ONLY stock_qty accepts pos.create;
 *    every other products write stays catalog-only.
 *  - containers, container_splits, used_oil_log, used_oil_drum writes accept
 *    pos.create or catalog.manage (sale side-effect tables).
 *  - stock_movements / stock_levels stay UNMAPPED (allowed): mapping them
 *    would newly restrict the purchase-receive flow that also writes them.
 *
 * The sim never starts the server: it runs the REAL requiredPermissions
 * extracted from server/index.js (same technique as sim_vps_port.js) over
 * the EXACT statement list completeSale sends — the stockOut statements
 * come from the real src/lib/stock.ts — and applies the same rule the
 * /api/transaction middleware applies: every statement must pass.
 *
 * Run:  node --experimental-strip-types sim_sale_permissions.js
 */

import { readFileSync } from 'node:fs';
import { stockOut } from '../src/lib/stock.ts';

const SRC = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const POSCART = readFileSync(new URL('../src/modules/pos/POSCart.tsx', import.meta.url), 'utf8');

// ── extract the REAL permission machinery from server/index.js ─────────────
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
const permSrc = SRC.slice(SRC.indexOf('const P = {'), SRC.indexOf('const permCache'));
const requiredPermissions = new Function(
  permSrc + '\n' + extractFunction(SRC, 'requiredPermissions') + '\nreturn requiredPermissions;'
)();

let ok = 0, total = 0, failed = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { failed++; console.log(`FAIL - ${title}: ${e.message}`); }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// The /api/transaction middleware's rule: EVERY statement must pass — a
// statement passes when it needs nothing, or when one of its keys is held.
function allowed(sql, perms) {
  const need = requiredPermissions(sql);
  return need === null || need.some((p) => perms.includes(p));
}

const WORKER1 = ['dashboard', 'customers', 'pos.create', 'sales_history'];

// ── the EXACT statement list completeSale sends (POSCart.tsx) ──────────────
// Product line + partial container + used-oil drop-off + vehicle + service
// reminder: the widest sale, so every branch of the bundle is covered.
const SALE_STATEMENTS = [
  "SELECT nextval(pg_get_serial_sequence('orders', 'id')) AS oid",
  'SELECT id FROM vehicles WHERE customer_id = $1 AND LOWER(registration) = LOWER($2) LIMIT 1',
  'UPDATE vehicles SET make=$1, model=$2, model_year=$3, color=$4, condition=$5, oil_capacity=$6 WHERE id=$7',
  'INSERT INTO vehicles (customer_id, registration, make, model, model_year, color, condition, mileage, oil_capacity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
  "INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, vehicle_id, mileage, notes, created_at) VALUES ($1, 1, $2, $3, $4, $4, $5, 'cash', 'completed', $6, $7, $8, NOW())",
  'INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
  "INSERT INTO containers (shop_id, product_id, original_volume, remaining_volume, status, opened_at, source_order_id) VALUES (1, $1, $2, $3, 'opened', NOW()::text, $4)",
  ...stockOut(1, 2, 'sale', 'uuid-sale-1', { table: 'orders', id: 101 }).map((s) => s.sql),
  "UPDATE containers SET remaining_volume = GREATEST(0, remaining_volume - $1), status = CASE WHEN remaining_volume - $1 <= 0 THEN 'empty' ELSE 'opened' END WHERE id = $2",
  'INSERT INTO container_splits (container_id, sold_qty, order_id) VALUES ($1, $2, $3)',
  'UPDATE used_oil_drum SET current_litres = current_litres + $1 WHERE id = 1',
  "INSERT INTO used_oil_log (drum_id, litres, type, source_order_id) VALUES (1, $1, 'added', $2)",
  'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
  "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1, $2, 'in', $3)",
  'UPDATE customers SET last_visit_at = NOW() WHERE id = $1',
  `INSERT INTO reminders
              (shop_id, kind, title, details, due_at, due_km, last_mileage,
               customer_id, vehicle_id, order_id, created_by_user_id)
            SELECT 1, 'service_due',
              'Service due: ' || NULLIF(TRIM(COALESCE(v.make, '') || ' ' || COALESCE(v.model, '') || ' ' || COALESCE(v.registration, '')), '') || ' (' || c.name || ')',
              'Next oil change / service for ' || c.name || ' — about ' || v.service_interval_km || ' km from the last visit.',
              now() + (v.service_interval_days || ' days')::interval,
              $2 + v.service_interval_km,
              $2,
              v.customer_id, v.id, $1, $3
            FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id
            WHERE v.id = $4
              AND NOT EXISTS (
                SELECT 1 FROM reminders r
                WHERE r.vehicle_id = v.id AND r.kind = 'service_due' AND r.status = 'pending'
              )`,
];

check('the statement list still matches POSCart.tsx (drift guard)', () => {
  assert(POSCART.includes('INSERT INTO containers (shop_id, product_id'), 'containers INSERT moved');
  assert(POSCART.includes('INSERT INTO container_splits'), 'container_splits INSERT moved');
  assert(POSCART.includes('INSERT INTO used_oil_log'), 'used_oil_log INSERT moved');
  assert(POSCART.includes('UPDATE used_oil_drum SET current_litres'), 'used_oil_drum UPDATE moved');
  assert(POSCART.includes('stockOut(item.ref_id'), 'stockOut call moved');
});

check('worker1 can complete the widest sale: every statement allowed', () => {
  const denied = SALE_STATEMENTS.filter((s) => !allowed(s, WORKER1));
  assert(
    denied.length === 0,
    'denied statements:\n' + denied.map((s) => '  - ' + s.slice(0, 100)).join('\n')
  );
});

check('the stock_qty-only products UPDATE is what opens the sale', () => {
  const bump = 'UPDATE products SET stock_qty = COALESCE(stock_qty, 0) + $1 WHERE id = $2';
  assert(allowed(bump, WORKER1), 'stock_qty bump denied for worker1');
  assert(
    JSON.stringify(requiredPermissions(bump).sort()) ===
      JSON.stringify(['catalog.manage', 'pos.create'].sort()),
    'bump must accept exactly pos.create | catalog.manage, got ' +
      JSON.stringify(requiredPermissions(bump))
  );
});

check('any other products write stays catalog-only for worker1', () => {
  const denied = [
    'UPDATE products SET price_walking = $1 WHERE id = $2',
    'UPDATE products SET stock_qty = $1, price_walking = $2 WHERE id = $3',
    'UPDATE products SET name = $1 WHERE id = $2',
    'INSERT INTO products (name, stock_qty) VALUES ($1, $2)',
    'DELETE FROM products WHERE id = $1',
  ].filter((s) => allowed(s, WORKER1));
  assert(denied.length === 0, 'these must stay denied: ' + denied.join(' | '));
});

check('containers / splits / used-oil writes accept pos.create', () => {
  for (const s of [
    "INSERT INTO containers (shop_id, product_id) VALUES (1, $1)",
    'UPDATE containers SET remaining_volume = $1 WHERE id = $2',
    'INSERT INTO container_splits (container_id, sold_qty, order_id) VALUES ($1, $2, $3)',
    'UPDATE used_oil_drum SET current_litres = current_litres + $1 WHERE id = 1',
    "INSERT INTO used_oil_log (drum_id, litres, type) VALUES (1, $1, 'added')",
  ]) {
    assert(allowed(s, WORKER1), 'denied for worker1: ' + s);
    assert(allowed(s, ['catalog.manage']), 'denied for a catalog manager: ' + s);
  }
});

check('stock_movements / stock_levels stay unmapped (purchase-receive safe)', () => {
  assert(requiredPermissions('INSERT INTO stock_movements (uuid) VALUES ($1)') === null, 'stock_movements got mapped');
  assert(
    requiredPermissions('INSERT INTO stock_levels (warehouse_id, product_id) VALUES ($1, $2)') === null,
    'stock_levels got mapped'
  );
});

check('a user with no POS key still cannot complete a sale', () => {
  const noPos = ['dashboard', 'customers', 'sales_history'];
  const denied = SALE_STATEMENTS.filter((s) => !allowed(s, noPos));
  assert(denied.length > 0, 'sale must need pos.create somewhere');
  assert(
    denied.some((s) => s.startsWith('INSERT INTO orders')),
    'orders INSERT must be among the denied statements'
  );
});

console.log(`\n${ok}/${total} checks passed${failed ? ` — ${failed} FAILED` : ''}`);
if (failed) process.exit(1);
