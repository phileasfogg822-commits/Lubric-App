import type { CartItem } from "../../lib/types";
import { dbGet, dbExecute, dbSelect, dbTransaction } from "../../lib/db";

import { stockOut } from "../../lib/stock";
import { newUuid } from "../../lib/uuid";

// The pure cart helpers live in src/lib/cart.ts (moved there so they have a
// test — node cannot import this .tsx file, which is how the addContainer
// over-draw and the uncapped addProduct survived untested). Everything is
// re-exported here, so POS.tsx / EditButton / POSPrint import sites are
// untouched. The two names completeSale itself calls are imported as well:
// an `export ... from` re-export alone creates no local binding.
import { leftoverLitres, validateSaleStock } from "../../lib/cart";
export {
  leftoverLitres,
  tierPrice,
  effectiveUnitPrice,
  repriceAll,
  addProduct,
  addService,
  addContainer,
  updateQty,
  updatePrice,
  updateCapacity,
  toggleBillByCapacity,
  toggleLeftoverToContainers,
  validateSaleStock,
} from "../../lib/cart";
export type { CartItem };

// Moved out to lib/units.ts and re-exported here, so the five existing call
// sites (POS, POSCart, EditButton) are untouched. It had NO test while it was
// defined in this file, which is how two real bugs survived: the regex reported
// a 1kg tub of grease as "1 litre", and read "-4L" as 4 litres.
import { packLitres } from "../../lib/units";
export { packLitres };

export interface SaleVehicle {
  registration: string;
  make: string;
  model: string;
  modelYear: string;
  color: string;
  condition: string;
}

export async function completeSale(
  cart: CartItem[],
  userId: number,
  customerId: number | null,
  paymentAccountId: number,
  total: number,
  mileage: number,
  notes: string,
  vehicle?: SaleVehicle | null
): Promise<number> {
  // Stock guard — FIRST, before any write (before the order id is reserved
  // and before the vehicle is touched): a sale must never take more than
  // the shop has. The old code checked nothing, so a finished product
  // could be sold until its stock read -2 and a container to -0.5L
  // (reported 2026-11-25). The availability is read live here, not taken
  // from the cart, so a stale figure can never oversell; the cart's own
  // caps (lib/cart.ts) are only the first line of defence. A blocked sale
  // throws with the product and the amount left, and writes nothing — the
  // operator sees it in the error banner and the stock stays put.
  const needProductIds = [...new Set(cart.filter((x) => x.kind === "product" && x.qty > 0).map((x) => x.ref_id))];
  const needContainerIds = [...new Set(cart.filter((x) => x.kind === "partial_container" && x.qty > 0 && x.container_id).map((x) => x.container_id as number))];
  const stockById = new Map<number, { name: string; qty: number }>();
  for (const pid of needProductIds) {
    const row = await dbGet<{ name: string; stock_qty: number }>(
      "SELECT name, stock_qty FROM products WHERE id = $1", [pid]);
    stockById.set(pid, { name: row?.name ?? `product #${pid}`, qty: Number(row?.stock_qty ?? 0) || 0 });
  }
  const containersById = new Map<number, { name: string; remaining: number }>();
  for (const cid of needContainerIds) {
    const row = await dbGet<{ product_name: string; remaining_volume: number }>(
      "SELECT p.name AS product_name, c.remaining_volume FROM containers c JOIN products p ON p.id = c.product_id WHERE c.id = $1", [cid]);
    containersById.set(cid, { name: row?.product_name ?? `container #${cid}`, remaining: Number(row?.remaining_volume ?? 0) || 0 });
  }
  const short = validateSaleStock(cart, stockById, containersById);
  if (short) throw new Error(short);

  // Reserve the order id up-front so the order row and every child row commit
  // together. (nextval is never rolled back, so a failed sale only leaves a gap.)
  const seq = await dbGet<{ oid: string }>("SELECT nextval(pg_get_serial_sequence('orders', 'id')) AS oid");
  const oid = Number(seq?.oid ?? 0);
  if (!oid) throw new Error("Could not allocate an order id");

  // Attach / update the customer's vehicle so the order carries it.
  // The engine oil capacity is remembered here so the next oil change prefills.
  let vehicleId: number | null = null;
  const reg = (vehicle?.registration ?? "").trim();
  const oilCap = cart.reduce((m, x) => Math.max(m, x.kind === "product" ? (x.capacity ?? 0) : 0), 0);
  if (customerId && reg) {
    const fields = [
      (vehicle?.make ?? "").trim(),
      (vehicle?.model ?? "").trim(),
      (vehicle?.modelYear ?? "").trim(),
      (vehicle?.color ?? "").trim(),
      (vehicle?.condition ?? "").trim(),
    ];
    const found = await dbGet<{ id: number }>(
      "SELECT id FROM vehicles WHERE customer_id = $1 AND LOWER(registration) = LOWER($2) LIMIT 1",
      [customerId, reg]
    );
    if (found?.id) {
      await dbExecute(
        "UPDATE vehicles SET make=$1, model=$2, model_year=$3, color=$4, condition=$5, oil_capacity=$6 WHERE id=$7",
        [...fields, oilCap, found.id]
      );
      vehicleId = found.id;
    } else {
      const ins = await dbExecute(
        "INSERT INTO vehicles (customer_id, registration, make, model, model_year, color, condition, mileage, oil_capacity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        [customerId, reg, ...fields, mileage, oilCap]
      );
      vehicleId = ((ins.rows?.[0] as { id?: number } | undefined)?.id) ?? null;
    }
  }

  // Everything below — the order plus all stock/account movements — is one transaction.
  const statements: { sql: string; params: unknown[] }[] = [
    {
      sql: `INSERT INTO orders (id, shop_id, customer_id, user_id, total, paid_amount, payment_account_id, payment_method, status, vehicle_id, mileage, notes, created_at) VALUES ($1, 1, $2, $3, $4, $4, $5, 'cash', 'completed', $6, $7, $8, NOW())`,
      params: [oid, customerId, userId, total, paymentAccountId, vehicleId, mileage, notes]
    }
  ];

  for (const item of cart) {
    const lo = item.kind === "product" ? leftoverLitres(item) : 0;
    // Unused oil returns to the shelf only when the line asks for it.
    const toContainers = item.kind === "product" && !!item.leftoverToContainers && lo > 0;
    const byCapacity = item.kind === "product" && !!item.billByCapacity;
    statements.push({
      sql: `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      params: [oid, item.kind, item.ref_id, item.name, item.qty, item.unit_price, item.line_total, item.container_id ?? null,
               // A container line's capacity IS the litres drawn (0.5L of a
               // 4L bottle), so the history shows it — the old code wrote 0
               // for every non-product line, and the sale vanished from the
               // capacity column even though the oil left the shelf.
               item.kind === "partial_container" ? item.qty : (item.kind === "product" ? (item.capacity ?? 0) : 0), lo, toContainers ? "container" : "customer", false, byCapacity]
    });
    // Shelve the unused oil as a partial container. The bill is untouched: the
    // customer has already been charged, pro-rata or for the whole bottle.
    if (toContainers) {
      statements.push({
        sql: "INSERT INTO containers (shop_id, product_id, original_volume, remaining_volume, status, opened_at, source_order_id) VALUES (1, $1, $2, $3, 'opened', NOW()::text, $4)",
        params: [item.ref_id, packLitres(item.product) || lo, lo, oid]
      });
    }
    if (item.kind === "product") {
      // Through the ledger, not a bare UPDATE: a sale has to be explainable as
      // "this much left the shelf for order #123", and rebuildable from history.
      statements.push(
        ...stockOut(item.ref_id, item.qty, "sale", newUuid(), {
          table: "orders",
          id: oid,
        })
      );
    }
    if (item.kind === "partial_container" && item.container_id) {
      // The draw is clamped at zero, like the edit/void paths already do:
      // the guard above blocks an over-draw with a clear error, and this
      // is the backstop so a draw can never take a bottle below zero even
      // if the guard's snapshot is stale. The old unclamped form is what
      // left a container at -0.5L (reported 2026-11-25).
      statements.push({ sql: "UPDATE containers SET remaining_volume = GREATEST(0, remaining_volume - $1), status = CASE WHEN remaining_volume - $1 <= 0 THEN 'empty' ELSE 'opened' END WHERE id = $2", params: [item.qty, item.container_id] });
      statements.push({ sql: "INSERT INTO container_splits (container_id, sold_qty, order_id) VALUES ($1, $2, $3)", params: [item.container_id, item.qty, oid] });
    }
    if (item.kind === "used_oil") {
      statements.push({ sql: "UPDATE used_oil_drum SET current_litres = current_litres + $1 WHERE id = 1", params: [item.qty] });
      statements.push({ sql: "INSERT INTO used_oil_log (drum_id, litres, type, source_order_id) VALUES (1, $1, 'added', $2)", params: [item.qty, oid] });
    }
  }

  if (total > 0) {
    statements.push({ sql: "UPDATE accounts SET balance = balance + $1 WHERE id = $2", params: [total, paymentAccountId] });
    statements.push({ sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1, $2, 'in', $3)", params: [paymentAccountId, total, `Order #${oid}`] });
  }

  if (customerId) {
    statements.push({ sql: "UPDATE customers SET last_visit_at = NOW() WHERE id = $1", params: [customerId] });
  }

  // Auto service reminder: when the bill includes a service and we know the
  // vehicle, schedule its next visit using the car's own interval (default
  // 60 days / 3,000 km). Deduped — no second pending reminder for the car.
  const hasService = cart.some((x) => x.kind === "service");
  if (hasService && vehicleId) {
    statements.push({
      sql: `INSERT INTO reminders
              (shop_id, kind, title, details, due_at, due_km, last_mileage,
               customer_id, vehicle_id, order_id, created_by_user_id)
            SELECT 1, 'service_due',
              'Service due: ' || NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', v.make, v.model, v.registration)), '') || ' (' || c.name || ')',
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
      params: [oid, mileage, userId, vehicleId]
    });
  }

  await dbTransaction(statements);

  return oid;
}

/**
 * Hand the unused oil back to the customer AFTER the sale.
 *
 * Used when the buyer comes back and asks for the leftover bottle that we kept:
 * the oil goes off the shelf (the container this order created is drawn down)
 * and the order line is flagged as released. The bill is not changed — they
 * already paid for the whole bottle.
 */
export async function releaseLeftoverToCustomer(
  orderId: number,
  orderItemId: number,
  productId: number,
  litres: number
): Promise<void> {
  const rows = await dbSelect<{ id: number; remaining_volume: number }>(
    "SELECT id, remaining_volume FROM containers WHERE source_order_id = $1 AND product_id = $2 ORDER BY id LIMIT 1",
    [orderId, productId]
  );
  const statements: { sql: string; params: unknown[] }[] = [];
  const c = rows[0];
  if (c) {
    const take = Math.min(litres, Number(c.remaining_volume) || 0);
    statements.push({
      sql: "UPDATE containers SET remaining_volume = GREATEST(0, remaining_volume - $1), status = CASE WHEN remaining_volume - $1 <= 0 THEN 'empty' ELSE status END WHERE id = $2",
      params: [take, c.id]
    });
  }
  statements.push({
    sql: "UPDATE order_items SET leftover_to = 'customer', leftover_released = TRUE WHERE id = $1",
    params: [orderItemId]
  });
  await dbTransaction(statements);
}
