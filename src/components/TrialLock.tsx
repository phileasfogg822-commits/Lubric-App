import ActivationCodeForm from "./ActivationCodeForm";
import type { TrialState } from "../lib/trialCore";

/**
 * Batch 16 (2026-11-28): the trial lock screen. This is the ONLY screen
 * a locked install shows — the whole app sits behind it until a valid
 * activation code is entered. Business data is NOT deleted by the lock;
 * it is only inaccessible until the code lands.
 *
 * Batch 16.1 (2026-11-28): a third lock reason — licence_expired. An
 * UNLOCK code is a 1-year licence, not forever; when it runs out the
 * screen says the licence has ended and to renew by contacting
 * grafixers.co.uk, with the same code box (a new unlock code renews for
 * another year). The code form itself lives in ActivationCodeForm, shared
 * with the login screen.
 *
 * Three lock reasons:
 *   - expired: the 7-day trial ran out — subscribe, get a code from Umar.
 *   - tampered: the PC clock moved backwards past the last launch the app
 *     saw. Fixing the date and restarting also clears it; a code clears
 *     it too.
 *   - licence_expired: the 1-year licence ran out — renew at grafixers.co.uk.
 */
export default function TrialLock({
  initial,
  onActivated,
}: {
  initial: TrialState;
  onActivated: () => void;
}) {
  const tampered = initial.status === "tampered";
  const licenceExpired = initial.status === "licence_expired";

  const title = tampered
    ? "Trial locked — clock changed"
    : licenceExpired
      ? "Your licence has ended"
      : "Your trial has ended";

  const body = tampered
    ? "The date on this PC moved backwards past the last time the app ran, so the trial locked itself. If the date is wrong, fix it and restart the app — or enter an activation code below to continue."
    : licenceExpired
      ? "Your 1-year licence for lubric.app has ended. To renew, contact Grafixers at grafixers.co.uk and we will send you a new activation code."
      : "Your 7-day trial of lubric.app has ended. To keep using the app, subscribe and enter the activation code we send you.";

  const dateLine = licenceExpired
    ? initial.expiryDate
      ? ` Licence ended ${initial.expiryDate}.`
      : ""
    : initial.firstDate
      ? ` Trial started ${initial.firstDate}.`
      : "";

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
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>{title}</div>
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 4 }}>lubric.app</div>
        </div>

        <p style={{ fontSize: "0.9rem", color: "#334155", lineHeight: 1.5, margin: "0 0 12px" }}>
          {body}
        </p>
        <p style={{ fontSize: "0.9rem", color: "#334155", lineHeight: 1.5, margin: "0 0 20px" }}>
          Your data is safe — nothing was deleted. It is only locked until a
          code is entered.
          {dateLine}
        </p>

        <ActivationCodeForm onActivated={onActivated} />

        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 16, textAlign: "center" }}>
          One code works once only. Ask Umar for a new code to extend your trial or renew your
          licence.
        </div>
      </div>
    </div>
  );
}
