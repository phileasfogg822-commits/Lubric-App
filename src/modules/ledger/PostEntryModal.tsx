import { useState } from "react";
import { Modal } from "../../components/Modal";
import { FormField } from "../../components/FormField";
import { currency, today } from "../../lib/format";
import type { PartyType } from "../../lib/ledger";

export type EntryKind = "payment" | "bill";

export interface EntryInput {
  amount: number;
  accountId: number | null;
  note: string;
  occurredAt: string;
  dueDate: string | null;
}

interface Props {
  kind: EntryKind;
  partyType: PartyType;
  partyName: string;
  /** Positive = they owe us, or we owe them. Prefills the amount. */
  balance: number;
  accounts: { id: number; name: string }[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: EntryInput) => void;
}

/**
 * One form for the two things that actually happen on a khata: goods go out on
 * account, and money comes back. Both post a single append-only ledger row —
 * the ledger is never edited in place, so a mistake is corrected with another
 * row rather than by rewriting history.
 */
export function PostEntryModal({
  kind,
  partyType,
  partyName,
  balance,
  accounts,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const customer = partyType === "customer";
  const [amount, setAmount] = useState(balance > 0.005 ? String(balance) : "");
  const [occurredAt, setOccurredAt] = useState(today());
  const [accountId, setAccountId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");

  const title =
    kind === "payment"
      ? `Payment ${customer ? "from" : "to"} ${partyName}`
      : `Bill on account - ${partyName}`;

  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0 && !!occurredAt;

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>
          {kind === "payment" ? (
            <>
              Records a credit on the khata and{" "}
              {accountId ? "moves the money in the chosen account" : "leaves the till untouched"}.
            </>
          ) : (
            <>Records a debit on the khata. No money changes hands, so no account is touched.</>
          )}
        </p>

        <FormField
          label={kind === "payment" ? "Amount received" : "Amount billed"}
          required
        >
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </FormField>

        {balance > 0.005 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setAmount(String(balance))}
          >
            {customer ? `Settle all ${currency(balance)}` : `Pay all ${currency(balance)}`}
          </button>
        )}

        <FormField label="Date" required>
          <input
            className="input"
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </FormField>

        {kind === "payment" && (
          <FormField label="Received into / paid from">
            <select
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Not booked to an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {!customer && kind === "bill" && (
          <FormField label="Invoice due">
            <input
              className="input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FormField>
        )}

        <FormField label="Note">
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              kind === "payment"
                ? customer
                  ? "Cash at the counter"
                  : "Paid by transfer"
                : "20L engine oil x 4 drums"
            }
          />
        </FormField>

        {error && <div className="alert alert-error">{error}</div>}

        <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
          <button
            className="btn btn-primary"
            disabled={!valid || saving}
            onClick={() =>
              onSubmit({
                amount: parsed,
                accountId: accountId === "" ? null : accountId,
                note: note.trim(),
                occurredAt,
                dueDate: dueDate || null,
              })
            }
          >
            {saving ? "Saving..." : kind === "payment" ? "Record payment" : "Add to khata"}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
