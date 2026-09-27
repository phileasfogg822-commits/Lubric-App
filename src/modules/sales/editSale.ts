import { dbSelect, dbTransaction } from "../../lib/db";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OrderRow {
  id: number; customer_id: number | null; user_id: number | null; total: number;
  paid_amount: number; payment_account_id: number | null; status: string;
  vehicle_id: number | null; mileage: number; notes: string; created_at: string;
  customer_name?: string | null; registration?: string | null; make?: string | null; model?: string | null;
}

export interface OrderItemRow {
  id: number; kind: string; ref_id: number; name: string; qty: number;
  unit_price: number; line_total: number; container_id: number | null;
  capacity: number; leftover_litres: number; leftover_to: string;
  leftover_released: boolean; billed_by_capacity: boolean;
}

/** An edited/new line. Leftover routing is resolved by the caller (it knows the pack size). */
export interface EditLine {
  id?: number;                    // existing order_items.id; absent = new line
  kind: string; ref_id: number; name: string;
  qty: number; unit_price: number; line_total: number;
  container_id?: number | null;
  capacity?: number; billedByCapacity?: boolean;
  leftoverLitres: number;         // litres shelved under this line after the edit
  leftoverTo: "container" | "customer";
}

// ── Loaders ──────────────────────────────────────────────────────────────────

export async function loadOrder(orderId: number): Promise<OrderRow | null> {
  const rows = await dbSelect<OrderRow>(
    `SELECT o.*, c.name AS customer_name, v.registration, v.make, v.model
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN vehicles v ON v.id = o.vehicle_id
     WHERE o.id = $1`, [orderId]);
  return rows[0] ?? null;
}

export function loadOrderItems(orderId: number): Promise<OrderItemRow[]> {
  return dbSelect<OrderItemRow>(
    `SELECT id, kind, ref_id, product_name AS name, qty, unit_price, line_total, container_id,
            capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity
     FROM order_items WHERE order_id = $1 ORDER BY id`, [orderId]);
}

/** Leftover implied by pack size and engine capacity. */
export function leftoverLitresFor(pack: number, capacity: number): number {
  if (pack <= 0 || capacity <= 0 || capacity >= pack) return 0;
  return Math.round((pack - capacity) * 1000) / 1000;
}

function drawDown(productId: number, litres: number, orderId: number) {
  return [{
    sql: `UPDATE containers SET remaining_volume = GREATEST(0, remaining_volume - $1),
          status = CASE WHEN remaining_volume - $1 <= 0 THEN 'empty' ELSE status END
          WHERE id = (SELECT id FROM containers WHERE source_order_id = $2 AND product_id = $3 ORDER BY id LIMIT 1)`,
    params: [litres, orderId, productId],
  }];
}

// ── Edit engine ──────────────────────────────────────────────────────────────

/**
 * Save edits to a completed order with compensating adjustments so stock, the
 * accounts ledger and the leftover containers stay consistent with the bill.
 * One transaction, all or nothing.
 */
export async function saveOrderEdits(
  orderId: number,
  lines: EditLine[],
  header: { customerId: number | null; mileage: number; notes: string; paidAmount: number }
): Promise<void> {
  const order = await loadOrder(orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "completed") throw new Error("Only completed orders can be edited");
  const old = await loadOrderItems(orderId);

  const st: { sql: string; params: unknown[] }[] = [];

  // 1 ─ Product stock: net change per product (bill shrank -> restock, grew -> draw).
  const delta: Record<number, number> = {};
  for (const o of old) if (o.kind === "product") delta[o.ref_id] = (delta[o.ref_id] ?? 0) + o.qty;
  for (const n of lines) if (n.kind === "product") delta[n.ref_id] = (delta[n.ref_id] ?? 0) - n.qty;
  for (const [pid, d] of Object.entries(delta)) {
    if (!d) continue;
    st.push({ sql: "UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2", params: [d, Number(pid)] });
  }

  // 2 ─ Leftover containers: keep the shelf in step with the edited routing.
  for (const o of old) {
    if (o.kind !== "product") continue;
    const n = lines.find((x) => x.id === o.id);
    const shelvedOld = o.leftover_to === "container" && !o.leftover_released ? o.leftover_litres : 0;
    const shelvedNew = n ? (n.leftoverTo === "container" ? n.leftoverLitres : 0) : 0;
    if (Math.abs(shelvedOld - shelvedNew) < 1e-9) continue;
    if (shelvedNew > shelvedOld) {
      const rows = await dbSelect<{ id: number }>(
        "SELECT id FROM containers WHERE source_order_id = $1 AND product_id = $2 ORDER BY id LIMIT 1",
        [orderId, o.ref_id]);
      if (rows[0]) {
        st.push({
          sql: "UPDATE containers SET remaining_volume = remaining_volume + $1, status = 'opened' WHERE id = $2",
          params: [shelvedNew - shelvedOld, rows[0].id],
        });
      } else {
        st.push({
          sql: "INSERT INTO containers (shop_id, product_id, original_volume, remaining_volume, status, opened_at, source_order_id) VALUES (1, $1, $2, $3, 'opened', NOW()::text, $4)",
          params: [o.ref_id, shelvedNew, shelvedNew, orderId],
        });
      }
    } else if (shelvedNew < shelvedOld) {
      st.push(...drawDown(o.ref_id, shelvedOld - shelvedNew, orderId));
    }
  }

  // 3 ─ Lines: update existing, insert new, delete removed.
  for (const n of lines) {
    if (n.id) {
      st.push({
        sql: `UPDATE order_items SET kind=$1, ref_id=$2, product_name=$3, qty=$4, unit_price=$5, line_total=$6,
              capacity=$7, billed_by_capacity=$8, leftover_litres=$9, leftover_to=$10 WHERE id=$11`,
        params: [n.kind, n.ref_id, n.name, n.qty, n.unit_price, n.line_total,
                 n.capacity ?? 0, n.billedByCapacity === true, n.leftoverLitres, n.leftoverTo, n.id],
      });
    } else {
      st.push({
        sql: `INSERT INTO order_items (order_id, kind, ref_id, product_name, qty, unit_price, line_total,
              container_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,$12)`,
        params: [orderId, n.kind, n.ref_id, n.name, n.qty, n.unit_price, n.line_total, n.container_id ?? null,
                 n.capacity ?? 0, n.leftoverLitres, n.leftoverTo, n.billedByCapacity === true],
      });
    }
  }
  const keep = new Set(lines.map((l) => l.id).filter(Boolean) as number[]);
  for (const o of old) {
    if (!keep.has(o.id)) st.push({ sql: "DELETE FROM order_items WHERE id = $1", params: [o.id] });
  }

  // 4 ─ Header. The new total comes from the edited lines.
  const newTotal = Math.round(lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0) * 100) / 100;
  const paid = Math.max(0, Math.min(Number(header.paidAmount) || 0, newTotal));
  st.push({
    sql: "UPDATE orders SET total=$1, paid_amount=$2, mileage=$3, notes=$4, customer_id=$5 WHERE id=$6",
    params: [newTotal, paid, header.mileage ?? 0, header.notes ?? "", header.customerId, orderId],
  });

  // 5 ─ Ledger true-up: posted so far for this order vs the new paid amount.
  const postedRows = await dbSelect<{ posted: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type IN ('in','transfer_in') THEN amount ELSE -amount END),0) AS posted
     FROM account_transactions WHERE reference = $1`, [`Order #${orderId}`]);
  const posted = Number(postedRows[0]?.posted ?? 0);
  const d = Math.round((paid - posted) * 100) / 100;
  if (Math.abs(d) > 0.004 && order.payment_account_id) {
    st.push({ sql: "UPDATE accounts SET balance = balance + $1 WHERE id = $2", params: [d, order.payment_account_id] });
    st.push({
      sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,$3,$4)",
      params: [order.payment_account_id, Math.abs(d), d > 0 ? "in" : "out", `Order #${orderId} adjustment`],
    });
  }

  await dbTransaction(st);
}

// ── Void ─────────────────────────────────────────────────────────────────────

/**
 * Cancel a completed order: stock returns, the shelved leftover folds back into
 * the returned bottle, the ledger movement is reversed, status -> 'cancelled'
 * (kept for the audit trail — reports exclude it).
 */
export async function voidOrder(orderId: number): Promise<void> {
  const order = await loadOrder(orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "completed") throw new Error("Only completed orders can be voided");
  const items = await loadOrderItems(orderId);
  const st: { sql: string; params: unknown[] }[] = [];

  for (const it of items) {
    if (it.kind === "product") {
      st.push({ sql: "UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2", params: [it.qty, it.ref_id] });
      if (it.leftover_to === "container" && !it.leftover_released && it.leftover_litres > 0) {
        st.push(...drawDown(it.ref_id, it.leftover_litres, orderId));
      }
    }
    if (it.kind === "partial_container" && it.container_id) {
      st.push({
        sql: "UPDATE containers SET remaining_volume = remaining_volume + $1, status = 'opened' WHERE id = $2",
        params: [it.qty, it.container_id],
      });
    }
    if (it.kind === "used_oil") {
      st.push({ sql: "UPDATE used_oil_drum SET current_litres = GREATEST(0, current_litres - $1) WHERE id = 1", params: [it.qty] });
      st.push({ sql: "INSERT INTO used_oil_log (drum_id, litres, type, source_order_id) VALUES (1, $1, 'removed', $2)", params: [it.qty, orderId] });
    }
  if (order.payment_account_id) {
    const postedRows = await dbSelect<{ posted: number }>(
      `SELECT COALESCE(SUM(CASE WHEN type IN ('in','transfer_in') THEN amount ELSE -amount END),0) AS posted
       FROM account_transactions WHERE reference = $1`, [`Order #${orderId}`]);
    const posted = Number(postedRows[0]?.posted ?? 0);
    if (Math.abs(posted) > 0.004) {
      st.push({ sql: "UPDATE accounts SET balance = balance - $1 WHERE id = $2", params: [posted, order.payment_account_id] });
      st.push({
        sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'out',$3)",
        params: [order.payment_account_id, posted, `Order #${orderId} void`],
      });
    }
  }

  st.push({ sql: "UPDATE orders SET status = 'cancelled' WHERE id = $1", params: [orderId] });
  await dbTransaction(st);
}
}

/** Hard delete — only for orders that were already voided. */
export async function deleteVoidedOrder(orderId: number): Promise<void> {
  const order = await loadOrder(orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "cancelled") throw new Error("Void the order first, then delete it");
  await dbTransaction([
    { sql: "DELETE FROM order_items WHERE order_id = $1", params: [orderId] },
    { sql: "DELETE FROM orders WHERE id = $1", params: [orderId] },
  ]);
}
