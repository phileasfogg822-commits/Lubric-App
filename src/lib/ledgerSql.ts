/**
 * SQL for the khata (server/migrations/014_party_ledger.sql).
 *
 * Kept in its own module — no imports, no browser globals — for two reasons:
 *   1. The app runs on BOTH dialects: PostgreSQL on the shop server, SQLite on
 *      the offline desktop (src/lib/localDb.ts). Everything here must survive
 *      `pgToSqlite()`: no to_char(), no AT TIME ZONE, no casts outside the
 *      list that function strips, no window functions, no FILTER.
 *   2. Being pure, the exact statements can be exercised by the e2e test
 *      against a real database (server/e2e_ledger.js) instead of being
 *      re-typed there and drifting.
 *
 * DIRECTION SEMANTICS (identical for customers and vendors, as in 014):
 *   customer - a debit INCREASES what they owe us
 *   vendor   - a debit INCREASES what we owe them
 * so a party's balance is always SUM(debit) - SUM(credit): positive means money
 * is owed in the counterparty's favour.
 */

// PartyType lives with the other domain types; re-exported so callers of this
// module can keep importing everything about the khata from one place.
import type { PartyType } from "./types";
export type { PartyType };

export interface Query {
  sql: string;
  params: unknown[];
}

export interface Statement {
  sql: string;
  params: unknown[];
}

const PARTY_TABLE: Record<PartyType, string> = {
  customer: "customers",
  vendor: "vendors",
};

/** The denormalised running total the rest of the app still reads. */
const PARTY_BALANCE_COLUMN: Record<PartyType, string> = {
  customer: "credit_balance",
  vendor: "payable_balance",
};

/** Signed amount of one row: debits add to the balance, credits take off. */
const SIGNED = "CASE WHEN l.direction = 'debit' THEN l.amount ELSE -l.amount END";

/** Money is stored as float; keep postings and balances to whole paisa. */
export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Every party with their ledger balance and the date of their last entry. */
export function partyBalancesQuery(partyType: PartyType): Query {
  return {
    sql: `SELECT p.id AS party_id, p.name, p.phone,
                 COALESCE(SUM(${SIGNED}), 0) AS balance,
                 MAX(l.occurred_at) AS last_entry_at
            FROM ${PARTY_TABLE[partyType]} p
            LEFT JOIN party_ledger l
              ON l.party_type = '${partyType}' AND l.party_id = p.id
           GROUP BY p.id, p.name, p.phone
           ORDER BY p.name`,
    params: [],
  };
}

/**
 * Balance at a point in time. With no `before`, that is the current balance;
 * with `before` it is the "balance b/d" a period statement opens with.
 */
export function balanceQuery(partyType: PartyType, partyId: number, before?: string): Query {
  const params: unknown[] = [partyType, partyId];
  let extra = "";
  if (before) {
    params.push(before);
    extra = ` AND l.occurred_at < $${params.length}`;
  }
  return {
    sql: `SELECT COALESCE(SUM(${SIGNED}), 0) AS balance
            FROM party_ledger l
           WHERE l.party_type = $1 AND l.party_id = $2${extra}`,
    params,
  };
}

export interface Period {
  /** "YYYY-MM-DD" inclusive. */
  from?: string;
  /** "YYYY-MM-DD" inclusive. */
  to?: string;
}

/**
 * The statement itself, oldest first with a running balance on every row.
 *
 * The running total is a correlated subquery rather than a window function
 * because SQLite is the floor here. The (occurred_at, id) tiebreak keeps it
 * correct even when several rows share a timestamp — the normal case, since a
 * sale writes its bill and its payment together.
 */
export function statementQuery(partyType: PartyType, partyId: number, period: Period = {}): Query {
  const params: unknown[] = [partyType, partyId];
  const where = ["l.party_type = $1", "l.party_id = $2"];
  if (period.from) {
    params.push(period.from);
    where.push(`l.occurred_at >= $${params.length}`);
  }
  if (period.to) {
    params.push(period.to);
    where.push(`l.occurred_at <= $${params.length}`);
  }
  return {
    sql: `SELECT l.id, l.uuid, l.kind, l.direction, l.amount, l.note,
                 l.occurred_at, l.order_id, l.vendor_payable_id,
                 (SELECT COALESCE(SUM(CASE WHEN l2.direction = 'debit'
                                           THEN l2.amount ELSE -l2.amount END), 0)
                    FROM party_ledger l2
                   WHERE l2.party_type = l.party_type
                     AND l2.party_id = l.party_id
                     AND (l2.occurred_at < l.occurred_at
                          OR (l2.occurred_at = l.occurred_at AND l2.id <= l.id))
                 ) AS running
            FROM party_ledger l
           WHERE ${where.join(" AND ")}
           ORDER BY l.occurred_at, l.id`,
    params,
  };
}

/**
 * Billed vs settled per month, newest first — "is he buying more or less than
 * last month?". date_trunc('month', x) is rewritten to date(x, 'start of
 * month') for SQLite by pgToSqlite, in the SELECT and the GROUP BY alike.
 */
export function monthlyQuery(partyType: PartyType, partyId: number, months = 6): Query {
  return {
    sql: `SELECT date_trunc('month', l.occurred_at) AS month,
                 COALESCE(SUM(CASE WHEN l.direction = 'debit'  THEN l.amount ELSE 0 END), 0) AS billed,
                 COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount ELSE 0 END), 0) AS settled,
                 COUNT(*) AS entries
            FROM party_ledger l
           WHERE l.party_type = $1 AND l.party_id = $2
           GROUP BY date_trunc('month', l.occurred_at)
           ORDER BY month DESC
           LIMIT $3`,
    params: [partyType, partyId, months],
  };
}

/** Open invoices per vendor, oldest due first, with what is already settled. */
export function openPayablesQuery(vendorId: number): Query {
  return {
    // "Settled" comes from payable_allocations (migration 017), NOT from
    // summing the ledger: an invoice's own bill row is linked to it, and one
    // payment can cover several invoices, so neither can be read off
    // party_ledger per payable without producing the wrong number.
    sql: `SELECT vp.id, vp.amount, vp.due_date, vp.status,
                 COALESCE((SELECT SUM(a.amount)
                             FROM payable_allocations a
                            WHERE a.vendor_payable_id = vp.id), 0) AS settled
            FROM vendor_payables vp
           WHERE vp.vendor_id = $1 AND vp.status IN ('pending', 'partial')
           ORDER BY (vp.due_date IS NULL), vp.due_date, vp.id`,
    params: [vendorId],
  };
}

export interface OpenPayable {
  id: number;
  amount: number;
  settled: number;
}

export interface PayableSettlement {
  id: number;
  /** How much of the payment went against this invoice. */
  amount: number;
  status: "paid" | "partial";
}

/**
 * Spread a payment over open invoices, oldest due first — how a shop actually
 * settles a supplier. Pure, so the e2e test can check the arithmetic without a
 * database. Anything left over is an advance and simply stays unallocated.
 */
export function allocatePayables(payables: OpenPayable[], amount: number): PayableSettlement[] {
  let left = round2(amount);
  const out: PayableSettlement[] = [];
  for (const p of payables) {
    if (left <= 0.005) break;
    const outstanding = round2(Number(p.amount) - Number(p.settled));
    if (outstanding <= 0.005) continue;
    const applied = round2(Math.min(outstanding, left));
    const covered = round2(Number(p.settled) + applied) >= round2(Number(p.amount)) - 0.005;
    out.push({ id: p.id, amount: applied, status: covered ? "paid" : "partial" });
    left = round2(left - applied);
  }
  return out;
}

/** Move the denormalised party balance in step with the ledger. */
function balanceStep(partyType: PartyType, partyId: number, delta: number): Statement {
  const column = PARTY_BALANCE_COLUMN[partyType];
  return {
    sql: `UPDATE ${PARTY_TABLE[partyType]}
             SET ${column} = COALESCE(${column}, 0) ${delta >= 0 ? "+" : "-"} $1
           WHERE id = $2`,
    params: [Math.abs(delta), partyId],
  };
}

export interface PaymentInput {
  uuid: string;
  partyType: PartyType;
  partyId: number;
  partyName: string;
  amount: number;
  /** Cash/bank account the money landed in; null = not booked to an account. */
  accountId: number | null;
  note: string;
  /** "YYYY-MM-DD" — when the money changed hands, which may be backdated. */
  occurredAt: string;
  /** Vendor invoices this payment settles, oldest first (allocatePayables). */
  settle: PayableSettlement[];
}

/**
 * Post a payment: one ledger row plus everything that must move with it, in a
 * single transaction so a half-posted payment is impossible.
 *
 * A payment is always a CREDIT — it reduces what the customer owes us, and
 * what we owe the vendor.
 */
export function paymentStatements(i: PaymentInput): Statement[] {
  const amount = round2(i.amount);
  const reference =
    i.partyType === "customer" ? `Payment from ${i.partyName}` : `Payment to ${i.partyName}`;
  const note = i.note.trim() || reference;

  const stmts: Statement[] = [
    {
      sql: `INSERT INTO party_ledger
              (uuid, shop_id, party_type, party_id, kind, direction, amount,
               vendor_payable_id, note, occurred_at, origin)
            VALUES ($1, 1, $2, $3, 'payment', 'credit', $4, $5, $6, $7, 'shop')`,
      params: [i.uuid, i.partyType, i.partyId, amount, i.settle[0]?.id ?? null, note, i.occurredAt],
    },
    balanceStep(i.partyType, i.partyId, -amount),
  ];

  if (i.accountId) {
    // A customer paying us is money in; us paying a vendor is money out.
    const incoming = i.partyType === "customer";
    stmts.push({
      sql: `UPDATE accounts SET balance = balance ${incoming ? "+" : "-"} $1 WHERE id = $2`,
      params: [amount, i.accountId],
    });
    stmts.push({
      sql: `INSERT INTO account_transactions (account_id, amount, type, reference)
            VALUES ($1, $2, '${incoming ? "in" : "out"}', $3)`,
      params: [i.accountId, amount, note],
    });
  }

  for (const s of i.settle) {
    stmts.push({
      // updated_at is bumped so a settled invoice replicates to the desktop.
      sql: "UPDATE vendor_payables SET status = $1, updated_at = NOW() WHERE id = $2",
      params: [s.status, s.id],
    });
    // The split of this payment across the invoices it clears. Referenced by
    // the payment's uuid, which is already known, so these can travel in the
    // same batch as the payment row itself.
    stmts.push({
      sql: `INSERT INTO payable_allocations (shop_id, payment_uuid, vendor_payable_id, amount)
            VALUES (1, $1, $2, $3)`,
      params: [i.uuid, s.id, s.amount],
    });
  }
  return stmts;
}

export interface BillInput {
  uuid: string;
  partyType: PartyType;
  partyId: number;
  partyName: string;
  amount: number;
  note: string;
  /** "YYYY-MM-DD" — when the goods went out / came in. */
  occurredAt: string;
  /** Vendor only: when the invoice falls due. */
  dueDate?: string | null;
}

/**
 * Post goods on account: a DEBIT that increases what the customer owes us, or
 * what we owe the vendor. No money changes hands, so no account is touched.
 */
export function billStatements(i: BillInput): Statement[] {
  const amount = round2(i.amount);
  const note =
    i.note.trim() || (i.partyType === "customer" ? "Goods on account" : "Purchase on account");
  const stmts: Statement[] = [];

  if (i.partyType === "vendor") {
    // A purchase on account is also an open payable: Reports and the vendor
    // screen read vendor_payables, and a later payment settles it FIFO.
    stmts.push({
      sql: `INSERT INTO vendor_payables (vendor_id, amount, due_date, status)
            VALUES ($1, $2, $3, 'pending')`,
      params: [i.partyId, amount, i.dueDate ?? null],
    });
  }

  // The vendor branch links the payable inserted just above. Inside one
  // transaction the newest id for that vendor is the row we wrote, and a plain
  // scalar subquery keeps this portable across both dialects (a RETURNING id
  // would not be readable from the statements that follow it in the batch).
  stmts.push(
    i.partyType === "vendor"
      ? {
          sql: `INSERT INTO party_ledger
                  (uuid, shop_id, party_type, party_id, kind, direction, amount,
                   vendor_payable_id, note, occurred_at, origin)
                VALUES ($1, 1, $2, $3, 'bill', 'debit', $4,
                        (SELECT id FROM vendor_payables WHERE vendor_id = $3 ORDER BY id DESC LIMIT 1),
                        $5, $6, 'shop')`,
          params: [i.uuid, i.partyType, i.partyId, amount, note, i.occurredAt],
        }
      : {
          sql: `INSERT INTO party_ledger
                  (uuid, shop_id, party_type, party_id, kind, direction, amount, note, occurred_at, origin)
                VALUES ($1, 1, $2, $3, 'bill', 'debit', $4, $5, $6, 'shop')`,
          params: [i.uuid, i.partyType, i.partyId, amount, note, i.occurredAt],
        }
  );

  stmts.push(balanceStep(i.partyType, i.partyId, amount));
  return stmts;
}
