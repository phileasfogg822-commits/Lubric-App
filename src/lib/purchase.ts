/**
 * Vendor invoice / stock-in — receive a shipment from a vendor (Umar,
 * 2026-11-27): "in vendors, when we create invoice, there should be a
 * list of products, like adding different products, their quantity, and
 * that will go directly to the stock... the price is against some
 * products, the list, the quantity, it should be added into the stock,
 * and there should be log of the added products available."
 *
 * Pure on purpose, like lib/payment.ts and lib/cart.ts: no imports from
 * the data layer (which reads import.meta.env and cannot load outside a
 * bundler), so the statement builder and the rules can be exercised by
 * the sim against a real database instead of being re-typed there and
 * drifting. The screen (modules/purchase/Purchase.tsx) does the reads —
 * reserving ids, resolving "add new name" lines against products — and
 * hands the resolved input to the builder, then runs the statements in
 * one dbTransaction.
 *
 * What one save writes, in ONE transaction (same pattern as completeSale):
 *   1. Any "add new name" line creates its product first (cost_price =
 *      the line's unit cost, stock_qty 0 — the stock-in below is what
 *      fills it), so the product exists before its movement references it.
 *   2. One purchase_orders row: total, paid now, status 'received' (the
 *      server's CHECK allows draft / received / cancelled — 'completed'
 *      is NOT in it, so the old local default would 403 on the VPS).
 *   3. One purchase_order_items row per line. Column names are the
 *      SERVER's (purchase_order_id, product_id, cost_price) — the local
 *      table used to say order_id / product_name / unit_cost, and the
 *      local patch in localDb.ts renames it (see
 *      patchPurchaseOrderItemsSchema). Server 001 already has these
 *      columns; server 036 adds the paid + notes columns the order row
 *      writes.
 *   4. One stock_movements row per line (kind 'purchase', ref
 *      purchase_orders / the order id) through lib/stock's stockIn, so
 *      products.stock_qty AND stock_levels move together — the same
 *      statements a sale uses in reverse. The movements ARE the log of
 *      what the invoice added; the Purchase screen reads them back per
 *      invoice and in the stock-in log tab.
 *   5. The vendor Khata pair from lib/ledgerSql, exactly the shape batch
 *      13 posts for a customer sale: bill (debit, full total) + payment
 *      (credit, paid now, only when something was paid). The bill also
 *      opens the vendor_payables row the payment settles FIFO — the
 *      payable id is reserved up-front and handed to billStatements, so
 *      the payment can settle the very row this invoice opened. The
 *      payment carries the till account, so money paid now leaves the
 *      till (a vendor payment is money OUT); the bill touches no
 *      account. The ledger rows carry NO order_id: the (order_id, kind)
 *      unique index is shared with till sales, and a purchase id can
 *      numerically collide with a sale id — the bill links to the
 *      payable instead (vendor_payable_id).
 *
 * Idempotency: the invoice carries ONE client-generated uuid (created
 * when the form opens, stable across retries of that form) and the
 * order INSERT lists it explicitly, so injectUuid leaves it alone. The
 * uuid is UNIQUE on both engines (server 012, local ensureLocalSchema),
 * so a double-submit retries the same uuid and the whole transaction
 * fails on the constraint — the stock is never added twice. A retry
 * reserves a NEW order id, but the uuid is what stops the second commit.
 */

import { billStatements, paymentStatements, allocatePayables, round2 } from "./ledgerSql.ts";
import type { Statement } from "./ledgerSql.ts";
import { stockIn } from "./stock.ts";
import { todayLocal } from "./payment.ts";
import { newUuid } from "./uuid.ts";

export interface PurchaseLineInput {
  /** Existing product, or null when the line names a new one. */
  productId: number | null;
  /** Name for a new product; ignored when productId is set. */
  newName: string;
  qty: number;
  /** Cost price per unit — the price against this product. */
  unitCost: number;
}

export interface PurchaseInvoiceInput {
  vendorId: number | null;
  lines: PurchaseLineInput[];
  /** Money handed to the vendor with the shipment; 0 = full due. */
  paidNow: number;
  /** Till account the paid-now money leaves; required when paidNow > 0. */
  accountId: number | null;
  notes: string;
}

/** A line with its product resolved — what the builder takes. */
export interface ResolvedPurchaseLine {
  productId: number;
  qty: number;
  unitCost: number;
}

/** A product the builder must create before its line can stock in. */
export interface NewPurchaseProduct {
  id: number;
  name: string;
  unitCost: number;
}

/** Line total, to whole paisa. */
export function purchaseLineTotal(line: { qty: number; unitCost: number }): number {
  return round2(Number(line.qty) * Number(line.unitCost));
}

/** Invoice total: the sum of the line totals. */
export function purchaseInvoiceTotal(lines: { qty: number; unitCost: number }[]): number {
  return round2(lines.reduce((sum, l) => sum + purchaseLineTotal(l), 0));
}

/**
 * The invoice rules, as one function returning the reason an invoice is
 * refused, or null when it may be saved. Both the screen and the save
 * path call it, so the two can never disagree: a vendor is required (a
 * shipment always comes from somebody), at least one line, every line a
 * positive quantity and a non-negative cost against a real or new product,
 * and paid now between 0 and the total (equal to the total IS paid in
 * full; more than the total is not a payment, it is a mistake).
 */
export function validatePurchaseInvoice(input: PurchaseInvoiceInput): string | null {
  if (input.vendorId == null) return "Pick a vendor first";
  if (!input.lines || input.lines.length === 0) return "Add at least one product";
  for (const line of input.lines) {
    if (line.productId == null && !line.newName.trim()) {
      return "Every line needs a product — pick one or add a new name";
    }
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      return "Every line needs a quantity greater than 0";
    }
    if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
      return "Every line needs a cost price of 0 or more";
    }
  }
  const total = purchaseInvoiceTotal(input.lines);
  if (!Number.isFinite(input.paidNow) || input.paidNow < 0) {
    return "Paid now cannot be less than 0";
  }
  if (round2(input.paidNow) > total) {
    return "Paid now cannot be more than the invoice total";
  }
  if (round2(input.paidNow) > 0 && input.accountId == null) {
    return "Pick the account the payment leaves from";
  }
  return null;
}

export interface BuildPurchaseInvoiceArgs {
  /** Reserved order id (nextval, like completeSale reserves its oid). */
  oid: number;
  /** Reserved vendor_payables id, so the payment settles the row this invoice opens. */
  payableId: number;
  vendorId: number;
  /** One uuid per form — stable across retries, so a double-submit 2067s instead of double-adding stock. */
  invoiceUuid: string;
  lines: ResolvedPurchaseLine[];
  /** Products to create before their lines stock in. */
  newProducts: NewPurchaseProduct[];
  total: number;
  paidNow: number;
  /** Till account the paid-now money leaves; null when nothing was paid. */
  accountId: number | null;
  notes: string;
  /** "YYYY-MM-DD" — when the shipment arrived. */
  occurredAt: string;
}

/**
 * The statements one invoice save runs, in one transaction. Pure: the
 * caller reserves the ids and resolves new names first, then runs the
 * returned statements through dbTransaction.
 */
export function buildPurchaseInvoiceStatements(a: BuildPurchaseInvoiceArgs): Statement[] {
  const total = round2(a.total);
  const paidNow = round2(a.paidNow);
  const statements: Statement[] = [];

  for (const p of a.newProducts) {
    statements.push({
      sql: "INSERT INTO products (id, shop_id, name, cost_price, stock_qty) VALUES ($1, 1, $2, $3, 0)",
      params: [p.id, p.name.trim(), round2(p.unitCost)],
    });
  }

  statements.push({
    sql: "INSERT INTO purchase_orders (id, shop_id, vendor_id, total, paid, status, notes, uuid) VALUES ($1, 1, $2, $3, $4, 'received', $5, $6)",
    params: [a.oid, a.vendorId, total, paidNow, (a.notes ?? "").trim(), a.invoiceUuid],
  });

  for (const line of a.lines) {
    const lineTotal = purchaseLineTotal(line);
    statements.push({
      sql: "INSERT INTO purchase_order_items (purchase_order_id, product_id, qty, cost_price, line_total) VALUES ($1, $2, $3, $4, $5)",
      params: [a.oid, line.productId, line.qty, round2(line.unitCost), lineTotal],
    });
    statements.push(
      ...stockIn(line.productId, line.qty, "purchase", newUuid(), {
        table: "purchase_orders",
        id: a.oid,
        note: `Invoice #${a.oid}`,
      })
    );
  }

  statements.push(
    ...billStatements({
      uuid: newUuid(),
      partyType: "vendor",
      partyId: a.vendorId,
      partyName: "",
      amount: total,
      note: `Purchase invoice #${a.oid}`,
      occurredAt: a.occurredAt,
      payableId: a.payableId,
    })
  );

  if (paidNow > 0) {
    statements.push(
      ...paymentStatements({
        uuid: newUuid(),
        partyType: "vendor",
        partyId: a.vendorId,
        partyName: "",
        amount: paidNow,
        accountId: a.accountId,
        note: `Paid on invoice #${a.oid}`,
        occurredAt: a.occurredAt,
        settle: allocatePayables(
          [{ id: a.payableId, amount: total, settled: 0 }],
          paidNow
        ),
      })
    );
  }

  return statements;
}

/** Today, local "YYYY-MM-DD", for the Khata rows. */
export function purchaseToday(): string {
  return todayLocal();
}
