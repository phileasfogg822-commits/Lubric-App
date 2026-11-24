import { useEffect, useState } from "react";

/**
 * Shared transaction feedback — one loading sign and one confirmation box
 * for every money/stock transaction in the app (POS sale, expense, khata
 * post, used-oil record, product save).
 *
 * The rule Umar asked for (2026-11-24): while the transaction runs, a
 * loading sign shows and the submit button is disabled; when it lands, a
 * confirmation box says so — with the reference where one exists, e.g.
 * "Order #123 completed" — and vanishes after exactly 2 seconds.
 *
 * `useTransactionDone` owns both pieces of state so each screen wires the
 * same two lines: setBusy(true) around the work, showDone(message) on
 * success. The timer lives in the hook, so a screen cannot forget to clear
 * the box or clear it after the wrong delay.
 */

/** How long the confirmation box stays up before it vanishes. */
export const TRANSACTION_DONE_MS = 2000;

export function useTransactionDone() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), TRANSACTION_DONE_MS);
    return () => clearTimeout(t);
  }, [done]);

  return { busy, setBusy, done, showDone: setDone };
}

/** The confirmation box. Renders nothing until showDone is called. */
export function TransactionDone({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="alert alert-success" role="status" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span aria-hidden style={{ fontWeight: 800 }}>✓</span>
      <span>{message}</span>
    </div>
  );
}

/** Small spinning ring for a submit button while its transaction runs. */
export function TransactionSpinner({ label }: { label?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="tx-spinner" aria-hidden />
      {label ?? "Working…"}
    </span>
  );
}
