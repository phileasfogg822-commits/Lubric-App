/**
 * Till payment options — pay in full, in part, or later (Umar, 2026-11-25).
 *
 * Pure on purpose: no imports from the app, no database, so the rules can be
 * unit-tested and the sim can import them without pulling in React. The
 * rules live here once and both call sites — completeSale (which must reject
 * a bad sale before it writes anything) and the POS header (which must not
 * let the operator submit one) — call the same function, so the two can
 * never disagree about what is allowed.
 *
 * The money rules:
 *   - Full: the whole total is collected now, in the chosen method. This is
 *     the only choice a walk-in can use — there is nobody to owe.
 *   - Partial: some of the total now, the rest owed. Needs a customer, and
 *     the amount paid now must be more than 0 and less than the total
 *     (equal to the total IS full; 0 IS later — both have their own choice).
 *   - Later: nothing now, the whole total owed. Needs a customer.
 *   - The amount actually owed afterwards is always total - paid now, which
 *     the app already derives from orders (Reports does exactly that), and
 *     the Khata ledger carries as bill minus payment.
 */
import { round2 } from "./ledgerSql.ts";

export type PaymentMethod = "cash" | "easypaisa" | "bank_transfer" | "pay_later";

export type PayChoice = "full" | "partial" | "later";

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "easypaisa", "bank_transfer"];

/** Short labels for the till radios and the receipt. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  easypaisa: "EasyPaisa",
  bank_transfer: "Bank transfer",
  pay_later: "Pay later",
};

/**
 * What is collected at the till for this sale. Full pays the total, partial
 * pays the entered amount, later pays nothing. The caller rounds the total
 * already; the result is rounded to whole paisa so the order row, the
 * account credit and the ledger payment can never disagree by a paisa.
 */
export function resolvePaidNow(total: number, choice: PayChoice, amountPaid: number): number {
  if (choice === "later") return 0;
  if (choice === "partial") return round2(amountPaid);
  return round2(total);
}

/**
 * The method recorded on the order row. A fully pay-later sale has no method
 * that received money, so it records 'pay_later' — the record shows nothing
 * was paid, rather than pretending it was cash.
 */
export function resolvePaymentMethod(choice: PayChoice, method: PaymentMethod): PaymentMethod {
  return choice === "later" ? "pay_later" : method;
}

/**
 * The sale's payment rules, as one function returning the reason a sale is
 * not allowed, or null when it may proceed. `hasCustomer` is whether a
 * customer is attached to the sale — not the name, which the rule does not
 * need. Runs before any write, so a rejected sale leaves no trace.
 */
export function validatePayment(
  total: number,
  choice: PayChoice,
  amountPaid: number,
  hasCustomer: boolean
): string | null {
  if (choice === "full") return null;
  if (!(total > 0)) {
    return "Partial and Pay later need a bill total above zero — this bill is empty.";
  }
  if (!hasCustomer) {
    return "Pick a customer first — a walk-in has nobody to owe, so only Full payment is possible.";
  }
  if (choice === "partial") {
    if (!Number.isFinite(amountPaid) || !(amountPaid > 0)) {
      return "Enter the amount paid now — it must be more than 0.";
    }
    if (round2(amountPaid) >= round2(total)) {
      return "A partial payment must be less than the total — that amount pays it in full.";
    }
  }
  return null;
}

/** Today's date as local YYYY-MM-DD, for ledger rows (the Khata takes a date, not a timestamp). */
export function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
