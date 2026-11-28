import { useState } from "react";
import { activateTrialCode } from "../lib/trial";
import type { TrialState } from "../lib/trialCore";

/**
 * Batch 16 (2026-11-28): the trial lock screen. This is the ONLY screen
 * a locked install shows — the whole app sits behind it until a valid
 * activation code is entered. Business data is NOT deleted by the lock;
 * it is only inaccessible until the code lands.
 *
 * Two lock reasons:
 *   - expired: the 7-day trial ran out — subscribe, get a code from Umar.
 *   - tampered: the PC clock moved backwards past the last launch the app
 *     saw. Fixing the date and restarting also clears it; a code clears
 *     it too.
 */
export default function TrialLock({
  initial,
  onActivated,
}: {
  initial: TrialState;
  onActivated: () => void;
}) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const tampered = initial.status === "tampered";

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
          setDone("Unlocked — lubric.app is yours permanently. Thank you!");
        } else {
          setDone(
            `Trial extended by ${res.daysAdded ?? 7} day${(res.daysAdded ?? 7) === 1 ? "" : "s"}. Welcome back!`
          );
        }
        // Let the message land, then reload: the gate re-reads the trial
        // state and opens the app.
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

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f172a 0%, #1e40af 100%)",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          padding: "2.5rem",
          width: 420,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>
            {tampered ? "Trial locked — clock changed" : "Your trial has ended"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 4 }}>lubric.app</div>
        </div>

        <p style={{ fontSize: "0.9rem", color: "#334155", lineHeight: 1.5, margin: "0 0 12px" }}>
          {tampered
            ? "The date on this PC moved backwards past the last time the app ran, so the trial locked itself. If the date is wrong, fix it and restart the app — or enter an activation code below to continue."
            : "Your 7-day trial of lubric.app has ended. To keep using the app, subscribe and enter the activation code we send you."}
        </p>
        <p style={{ fontSize: "0.9rem", color: "#334155", lineHeight: 1.5, margin: "0 0 20px" }}>
          Your data is safe — nothing was deleted. It is only locked until a
          code is entered.
          {initial.firstDate ? ` Trial started ${initial.firstDate}.` : ""}
        </p>

        {done ? (
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
        ) : (
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
        )}

        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 16, textAlign: "center" }}>
          One code works once only. Ask Umar for a new code to extend your trial or unlock the app.
        </div>
      </div>
    </div>
  );
}
