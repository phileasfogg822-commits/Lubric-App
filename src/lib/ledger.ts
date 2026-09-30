/**
 * Khata data access — the read and write side of party_ledger
 * (server/migrations/014_party_ledger.sql).
 *
 * Nothing here stores a balance: every number is derived from the ledger rows,
 * so the statement, the summary and the month-on-month comparison can never
 * disagree with each other. The statements themselves live in ledgerSql.ts so
 * they stay dialect-portable and testable.
 */

import { dbSelect, dbTransaction } from "./db";
import { newUuid } from "./uuid";
import type { LedgerDirection, LedgerKind } from "./types";
import {
  allocatePayables,
  balanceQuery,
  billStatements,
  monthlyQuery,
  openPayablesQuery,
  partyBalancesQuery,
  paymentStatements,
  round2,
  statementQuery,
  type PartyType,
  type Period,
} from "./ledgerSql";

export type { PartyType, Period } from "./ledgerSql";

export interface PartyBalance {
  party_id: number;
  name: string;
  phone: string;
  /** Positive = they owe us (customer) or we owe them (vendor). */
  balance: number;
  last_entry_at: string | null;
}

export interface StatementRow {
  id: number;
  uuid: string;
  kind: LedgerKind;
  direction: LedgerDirection;
  amount: number;
  note: string;
  occurred_at: string;
  order_id: number | null;
  vendor_payable_id: number | null;
  running: number;
}

export interface MonthlyRow {
  /** First instant of the month; format in the UI (Postgres and SQLite differ). */
  month: string;
  billed: number;
  settled: number;
  entries: number;
}

export interface StatementView {
  rows: StatementRow[];
  /** Balance carried into the period — the statement's "balance b/d". */
  opening: number;
  totalDebit: number;
  totalCredit: number;
  /** Current balance, all periods — the figure the shop is owed / owes. */
  balance: number;
  period: Period;
}

const num = (v: unknown): number => Number(v) || 0;

/** Every customer (or vendor) with their ledger balance. */
export async function listParties(partyType: PartyType): Promise<PartyBalance[]> {
  const q = partyBalancesQuery(partyType);
  const rows = await dbSelect<any>(q.sql, q.params);
  return rows.map((r) => ({
    party_id: Number(r.party_id),
    name: String(r.name ?? ""),
    phone: String(r.phone ?? ""),
    balance: round2(num(r.balance)),
    last_entry_at: r.last_entry_at ? String(r.last_entry_at) : null,
  }));
}

/** The statement for one party over a period, plus its opening balance. */
export async function fetchStatement(
  partyType: PartyType,
  partyId: number,
  period: Period = {}
): Promise<StatementView> {
  const rowsQ = statementQuery(partyType, partyId, period);
  const [rows, opening, current] = await Promise.all([
    dbSelect<any>(rowsQ.sql, rowsQ.params),
    period.from
      ? dbSelect<any>(balanceQuery(partyType, partyId, period.from).sql, [
          partyType,
          partyId,
          period.from,
        ])
      : Promise.resolve([{ balance: 0 }] as any[]),
    dbSelect<any>(balanceQuery(partyType, partyId).sql, [partyType, partyId]),
  ]);

  const typed: StatementRow[] = rows.map((r) => ({
    id: Number(r.id),
    uuid: String(r.uuid ?? ""),
    kind: (String(r.kind) as LedgerKind),
    direction: r.direction === "credit" ? "credit" : "debit",
    amount: round2(num(r.amount)),
    note: String(r.note ?? ""),
    occurred_at: String(r.occurred_at ?? ""),
    order_id: r.order_id == null ? null : Number(r.order_id),
    vendor_payable_id: r.vendor_payable_id == null ? null : Number(r.vendor_payable_id),
    running: round2(num(r.running)),
  }));

  const totalDebit = round2(
    typed.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0)
  );
  const totalCredit = round2(
    typed.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0)
  );

  return {
    rows: typed,
    opening: round2(num(opening[0]?.balance)),
    totalDebit,
    totalCredit,
    balance: round2(num(current[0]?.balance)),
    period,
  };
}

/** Billed vs settled per month, newest first. */
export async function fetchMonthly(
  partyType: PartyType,
  partyId: number,
  months = 6
): Promise<MonthlyRow[]> {
  const q = monthlyQuery(partyType, partyId, months);
  const rows = await dbSelect<any>(q.sql, q.params);
  return rows.map((r) => ({
    month: String(r.month),
    billed: round2(num(r.billed)),
    settled: round2(num(r.settled)),
    // COUNT(*) comes back as a string from Postgres (int8) but a number from
    // SQLite, so it is normalised here rather than at every call site.
    entries: num(r.entries),
  }));
}

export interface PostPayment {
  partyType: PartyType;
  partyId: number;
  partyName: string;
  amount: number;
  accountId: number | null;
  note?: string;
  occurredAt: string;
}

/**
 * Record money changing hands. One transaction: the ledger row, the party's
 * denormalised balance, the account it landed in and — for vendors — the
 * invoices it settles. Either all of it is visible or none of it is.
 */
export async function recordPayment(input: PostPayment): Promise<void> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error("Enter a payment amount greater than zero");

  // A vendor payment settles the oldest invoices first; a customer payment has
  // no invoices to allocate to.
  let settle: ReturnType<typeof allocatePayables> = [];
  if (input.partyType === "vendor") {
    const q = openPayablesQuery(input.partyId);
    const open = await dbSelect<any>(q.sql, q.params);
    settle = allocatePayables(
      open.map((r) => ({ id: Number(r.id), amount: num(r.amount), settled: num(r.settled) })),
      amount
    );
  }

  await dbTransaction(
    paymentStatements({
      uuid: newUuid(),
      partyType: input.partyType,
      partyId: input.partyId,
      partyName: input.partyName,
      amount,
      accountId: input.accountId,
      note: input.note ?? "",
      occurredAt: input.occurredAt,
      settle,
    })
  );
}

export interface PostBill {
  partyType: PartyType;
  partyId: number;
  partyName: string;
  amount: number;
  note?: string;
  occurredAt: string;
  /** Vendor only. */
  dueDate?: string | null;
}

/** Record goods/services on account — the udhaar a customer runs up. */
export async function recordBill(input: PostBill): Promise<void> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error("Enter an amount greater than zero");

  await dbTransaction(
    billStatements({
      uuid: newUuid(),
      partyType: input.partyType,
      partyId: input.partyId,
      partyName: input.partyName,
      amount,
      note: input.note ?? "",
      occurredAt: input.occurredAt,
      dueDate: input.dueDate ?? null,
    })
  );
}
