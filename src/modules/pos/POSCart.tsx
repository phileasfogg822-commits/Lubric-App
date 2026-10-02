import type { Product, CustomerType, CartItem } from "../../lib/types";
import { dbGet, dbExecute, dbSelect, dbTransaction } from "../../lib/db";

import { resolvePrice, type PriceSource } from "../../lib/pricing";
import { stockOut } from "../../lib/stock";
import { newUuid } from "../../lib/uuid";

export type { CartItem };

// Moved out to lib/units.ts and re-exported here, so the five existing call
// sites (POS, POSCart, EditButton) are untouched. It had NO test while it was
// defined in this file, which is how two real bugs survived: the regex reported
// a 1kg tub of grease as "1 litre", and read "-4L" as 4 litres.
import { packLitres } from "../../lib/units";
export { packLitres };

/**
 * How much oil is left in the bottle: pack size minus what the engine took.
 * A 4L bottle into a 3.5L engine leaves 0.5L. Returns 0 when the capacity is
 * unknown, or when it meets/exceeds the pack (customer keeps the whole bottle).
 */
export function leftoverLitres(item: CartItem): number {
  const pack = packLitres(item.product);
  const cap = item.capacity ?? 0;
  if (pack <= 0 || cap <= 0 || cap >= pack) return 0;
  return Math.round((pack - cap) * 1000) / 1000;
}

/**
 * Price for one line, before any capacity pro-rating.
 *
 * This used to be `pf()`, a second copy of the tier rules that already lived in
 * POSSearch.tsx. Two copies of a pricing rule is how a customer gets quoted one
 * number in the search results and charged another in the cart, so the rule now
 * lives once in src/lib/pricing.ts and both screens call it.
 *
 * `ctx` is the customer's price context (their price list and any individually
 * agreed prices). It is optional and defaults to empty, which resolves through
 * the product's own tier columns exactly as before - that fallback is what lets
 * this ship without changing a single price the shop already charges.
 */
export function tierPrice(
  p: Product,
  ct: CustomerType,
  qty: number,
  ctx: PriceSource = {}
): number {
  return resolvePrice(p.id, ct, qty, { ...ctx, product: p }).price || 0;
}

/**
 * Price for a single line, honouring the "bill by capacity" switch.
 *
 * A 4L bottle at 4000 poured into a 3.5L engine is billed 3.5/4 x 4000 = 3500
 * when the switch is on. With it off (or no capacity recorded, or the capacity
 * meeting/exceeding the pack) the full bottle price applies.
 */
export function effectiveUnitPrice(item: CartItem, tierPrice: number): number {
  if (item.kind !== "product" || !item.billByCapacity) return tierPrice;
  const pack = packLitres(item.product);
  const cap = item.capacity ?? 0;
  if (pack <= 0 || cap <= 0 || cap >= pack) return tierPrice;
  return Math.round(tierPrice * (cap / pack) * 100) / 100; // paisa-safe
}

/** Re-price a single line from its product + tier, applying capacity pro-rating. */
function reprice(item: CartItem, ct: CustomerType, ctx: PriceSource): CartItem {
  if (item.kind !== "product" || !item.product) return item;
  const u = effectiveUnitPrice(item, tierPrice(item.product, ct, item.qty, ctx));
  return { ...item, unit_price: u, line_total: u * item.qty };
}

/**
 * Re-price every product line.
 *
 * Called whenever the answer could have changed: the tier switched, a customer
 * was chosen, or a capacity was entered. All three change what an item costs,
 * so all three route through here rather than each nudging prices itself.
 */
export function repriceAll(cart: CartItem[], ct: CustomerType, ctx: PriceSource = {}): CartItem[] {
  return cart.map((x) => reprice(x, ct, ctx));
}

export function addProduct(
  cart: CartItem[],
  p: Product,
  ct: CustomerType,
  products: Product[],
  ctx: PriceSource = {}
): CartItem[] {
  const ex = cart.find((x) => x.kind === "product" && x.ref_id === p.id);
  if (ex) return cart.map((x) => {
    if (x !== ex) return x;
    const nq = x.qty + 1;
    const u = effectiveUnitPrice(x, tierPrice(p, ct, nq, ctx));
    return { ...x, qty: nq, unit_price: u, line_total: u * nq };
  });
  const fresh: CartItem = {
    id: `p-${p.id}-${Date.now()}`, kind: "product", ref_id: p.id, name: p.name,
    qty: 1, unit_price: 0, line_total: 0, product: p,
    // Defaults: charged for what the engine takes, remainder back on the shelf.
    billByCapacity: true, leftoverToContainers: true,
  };
  const u = effectiveUnitPrice(fresh, tierPrice(p, ct, 1, ctx));
  return [...cart, { ...fresh, unit_price: u, line_total: u }];
}

export function addService(cart: CartItem[], s: { id: number; name: string; price: number }): CartItem[] {
  const ex = cart.find((x) => x.kind === "service" && x.ref_id === s.id);
  if (ex) return cart.map((x) => x === ex ? { ...x, qty: x.qty + 1, line_total: x.unit_price * (x.qty + 1) } : x);
  return [...cart, { id: `s-${s.id}-${Date.now()}`, kind: "service", ref_id: s.id, name: s.name, qty: 1, unit_price: s.price, line_total: s.price }];
}

export function addContainer(
  cart: CartItem[],
  c: any,
  ct: CustomerType,
  products: Product[],
  ctx: PriceSource = {}
): CartItem[] {
  const ex = cart.find((x) => x.kind === "partial_container" && x.container_id === c.id);
  if (ex) return cart.map((x) => x === ex && x.qty < c.remaining_volume ? { ...x, qty: x.qty + 1, line_total: x.unit_price * (x.qty + 1) } : x);
  const p = products.find((pr: Product) => pr.id === c.product_id);
  const u = p ? tierPrice(p, ct, 1, ctx) : 0;
  return [...cart, { id: `c-${c.id}-${Date.now()}`, kind: "partial_container", ref_id: c.id, name: `${c.product_name} (${c.remaining_volume.toFixed(1)}L left)`, qty: 1, unit_price: u, line_total: u, container_id: c.id, max_qty: c.remaining_volume }];
}

export function updateQty(
  cart: CartItem[],
  id: string,
  qty: number,
  ct: CustomerType,
  ctx: PriceSource = {}
): CartItem[] {
  return cart.map((x) => {
    if (x.id !== id) return x;
    const max = x.max_qty ?? 9999;
    const nq = Math.max(0, Math.min(qty, max));
    if (nq === 0) return x;
    if (x.kind === "product" && x.product) {
      const u = effectiveUnitPrice(x, tierPrice(x.product, ct, nq, ctx));
      return { ...x, qty: nq, unit_price: u, line_total: u * nq };
    }
    return { ...x, qty: nq, line_total: x.unit_price * nq };
  }).filter((x) => x.qty > 0);
}

export function updatePrice(cart: CartItem[], id: string, price: number): CartItem[] {
  return cart.map((x) => x.id === id ? { ...x, unit_price: price, line_total: price * x.qty } : x);
}

/**
 * Set the engine oil capacity on a line and re-price it.
 * The capacity drives both the pro-rated price and the leftover volume.
 */
export function updateCapacity(cart: CartItem[], id: string, litres: number, ct: CustomerType): CartItem[] {
  return repriceAll(cart.map((x) => (x.id === id ? { ...x, capacity: litres } : x)), ct);
}

/**
 * Turn capacity-based billing on/off for a line.
 * Turning it on also sends the unused oil back to the containers shelf, so the
 * switch defaults behave the way the shop expects; the operator can override
 * the leftover destination afterwards.
 */
export function toggleBillByCapacity(cart: CartItem[], id: string, on: boolean, ct: CustomerType): CartItem[] {
  return repriceAll(cart.map((x) => (x.id === id ? { ...x, billByCapacity: on, leftoverToContainers: on } : x)), ct);
}

/** Choose where the unused oil goes: back on the shelf, or home with the customer. */
export function toggleLeftoverToContainers(cart: CartItem[], id: string, toContainers: boolean): CartItem[] {
  return cart.map((x) => (x.id === id ? { ...x, leftoverToContainers: toContainers } : x));
}

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
               item.kind === "product" ? (item.capacity ?? 0) : 0, lo, toContainers ? "container" : "customer", false, byCapacity]
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
      statements.push({ sql: "UPDATE containers SET remaining_volume = remaining_volume - $1, status = CASE WHEN remaining_volume - $1 <= 0 THEN 'empty' ELSE 'opened' END WHERE id = $2", params: [item.qty, item.container_id] });
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
