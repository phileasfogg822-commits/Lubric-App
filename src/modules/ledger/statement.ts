/**
 * Presentation helpers for the khata screen: period presets, month keys, and
 * the plain-text statement the shop sends to a customer on WhatsApp.
 */

import type { PartyBalance, StatementView } from "../../lib/ledger";
import type { Period } from "../../lib/ledgerSql";
import { currency, d } from "../../lib/format";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export type PeriodKey = "all" | "this_month" | "last_month" | "last_3" | "last_6" | "custom";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_3", label: "Last 3 months" },
  { key: "last_6", label: "Last 6 months" },
  { key: "custom", label: "Custom range" },
];

/**
 * Resolve a preset to a concrete period.
 *
 * "This month" runs to today rather than to the end of the month, so the
 * comparison against a full previous month is never flattered by days that
 * have not happened yet.
 */
export function periodFor(
  key: PeriodKey,
  custom: { from: string; to: string },
  now = new Date()
): Period {
  const firstOf = (offset: number) => new Date(now.getFullYear(), now.getMonth() + offset, 1);
  switch (key) {
    case "this_month":
      return { from: isoDate(firstOf(0)), to: isoDate(now) };
    case "last_month": {
      const start = firstOf(-1);
      return { from: isoDate(start), to: isoDate(new Date(now.getFullYear(), now.getMonth(), 0)) };
    }
    case "last_3":
      return { from: isoDate(firstOf(-2)), to: isoDate(now) };
    case "last_6":
      return { from: isoDate(firstOf(-5)), to: isoDate(now) };
    case "custom":
      return { from: custom.from || undefined, to: custom.to || undefined };
    case "all":
    default:
      return {};
  }
}

export function periodLabel(period: Period, key: PeriodKey): string {
  if (!period.from && !period.to) return "All time";
  if (period.from && period.to) return `${d(period.from)} - ${d(period.to)}`;
  if (period.from) return `From ${d(period.from)}`;
  return `Up to ${d(period.to)}`;
}

/**
 * "YYYY-MM" for a month bucket.
 *
 * Postgres hands back a timestamptz and SQLite a "YYYY-MM-DD" string, so the
 * first seven characters are the only thing both agree on. Reading a Date with
 * getUTC* keeps the same UTC basis — a shop in UTC+5 must not see a bucket
 * shift into the previous month.
 */
export function monthKey(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}`;
  }
  return String(value).slice(0, 7);
}

/** "Sep 2026" from a month bucket. */
export function monthLabel(value: string | Date | null | undefined): string {
  const key = monthKey(value);
  if (!/^\d{4}-\d{2}$/.test(key)) return String(value ?? "");
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

const KIND_LABEL: Record<string, string> = {
  opening: "Opening balance",
  bill: "Bill",
  payment: "Payment",
  return: "Return",
  adjustment: "Adjustment",
};

export function kindLabel(row: { kind: string; direction: string }, customer: boolean): string {
  if (row.kind === "payment") return customer ? "Payment received" : "Payment made";
  return KIND_LABEL[row.kind] ?? row.kind;
}

/** Percentage change, guarding the "no last month to compare against" case. */
export function pctChange(thisMonth: number, lastMonth: number): number | null {
  if (Math.abs(lastMonth) < 0.005) return null;
  return ((thisMonth - lastMonth) / Math.abs(lastMonth)) * 100;
}

/**
 * The statement as plain text — what the shop actually sends to a customer.
 * Oldest first, with the running balance, then the closing figure.
 */
export function statementText(
  party: PartyBalance,
  view: StatementView,
  period: Period,
  key: PeriodKey,
  customer: boolean
): string {
  const lines: string[] = [];
  lines.push(`*${customer ? "Customer" : "Supplier"} statement*`);
  lines.push(party.name + (party.phone ? ` (${party.phone})` : ""));
  lines.push(`Period: ${periodLabel(period, key)}`);
  lines.push("");

  if (view.period.from) {
    lines.push(`Balance b/d: ${currency(view.opening)}`);
  }

  if (!view.rows.length) {
    lines.push("No entries in this period.");
  }
  for (const row of view.rows) {
    const amount = row.direction === "debit" ? currency(row.amount) : `- ${currency(row.amount)}`;
    lines.push(
      `${d(row.occurred_at)}  ${kindLabel(row, customer)}${row.note ? ` - ${row.note}` : ""}  ` +
        `${amount}  (bal ${currency(row.running)})`
    );
  }

  lines.push("");
  lines.push(`Total billed: ${currency(view.totalDebit)}`);
  lines.push(`Total settled: ${currency(view.totalCredit)}`);
  lines.push(
    `*${view.balance > 0.005 ? (customer ? "Amount due" : "Amount payable") : "Settled in full"}: ${currency(Math.abs(view.balance))}*`
  );
  return lines.join("\n");
}
