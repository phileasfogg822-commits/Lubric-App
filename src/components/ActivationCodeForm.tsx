import { useState } from "react";
import { activateTrialCode } from "../lib/trial";

/**
 * Batch 16.1 (2026-11-28): the activation-code form, shared by the lock
 * screen (TrialLock) and the login screen (Login). One form, one verifier,
 * one set of rules everywhere a code can be entered:
 *
 *   - the code is verified offline against the public key baked into the
 *     app (Ed25519 — only Umar can mint codes);
 *   - a code works once only (the app stores the SHA-512 of spent codes);
 *   - EXTEND adds days from max(today, current expiry);
 *   - UNLOCK is a 1-YEAR LICENCE from max(today, current expiry), not
 *     forever — the success message says so, with the date it runs until.
 *
 * `onActivated` runs after the success message has landed (same 1.2s
 * pause as the lock screen): the lock screen reloads the gate, the login
 * screen refreshes the trial line.
 */
export default function ActivationCodeForm({ onActivated }: { onActivated: () => void }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setMessage("Enter the activation code first.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await activateTrialCode(trimmed);
      if (res.ok) {
        if (res.kind === "unlock") {
          setDone(
            `Licensed until ${res.state?.expiryDate ?? "one year from today"} — thank you!`
          );
        } else {
          setDone(
            `Trial extended by ${res.daysAdded ?? 7} day${(res.daysAdded ?? 7) === 1 ? "" : "s"}. Welcome back!`
          );
        }
        // Let the message land, then hand back: the caller re-reads the
        // trial state (gate re-opens, or the login line updates).
        setTimeout(() => onActivated(), 1200);
      } else {
        setMessage(res.reason ?? "That code did not work. Check it and try again.");
      }
    } catch {
      setMessage("Something went wrong while checking the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        style={{
          background: "#dcfce7",
          color: "#166534",
          borderRadius: 8,
          padding: "12px 14px",
          fontSize: "0.9rem",
          textAlign: "center",
        }}
      >
        {done}
      </div>
    );
  }

  return (
    <form onSubmit={handleActivate}>
      <label
        htmlFor="trial-code"
        style={{
          display: "block",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: ".04em",
          marginBottom: 6,
        }}
      >
        Activation code
      </label>
      <input
        id="trial-code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="XXXXX-XXXXX-XXXXX…"
        autoComplete="off"
        spellCheck={false}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 12px",
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          fontSize: "0.85rem",
          fontFamily: "monospace",
          marginBottom: 12,
        }}
      />
      {message && (
        <div style={{ color: "#dc2626", fontSize: "0.85rem", marginBottom: 12 }}>{message}</div>
      )}
      <button
        type="submit"
        disabled={busy}
        style={{
          width: "100%",
          padding: "11px",
          border: "none",
          borderRadius: 8,
          background: busy ? "#94a3b8" : "#1e40af",
          color: "white",
          fontSize: "0.95rem",
          fontWeight: 700,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "Checking…" : "Activate"}
      </button>
    </form>
  );
}
