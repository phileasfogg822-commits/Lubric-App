/**
 * Batch 17 (2026-11-28): update prompt.
 *
 * On launch, when online, the app checks the updater feed for a newer
 * version. If one exists this shows ONE clear prompt: the new version,
 * its notes, an "Update now" button and a "Later" button. NOTHING is
 * downloaded or installed until the user taps "Update now" — never
 * automatically, never in the background. While downloading it shows the
 * progress; after install the app restarts itself into the new version.
 * Offline, no feed, or already current: renders nothing, silently.
 */
import { useEffect, useState } from "react";
import { isTauri } from "../lib/db";
import {
  AvailableUpdate,
  checkForUpdate,
  installUpdate,
} from "../lib/updaterClient";

type Phase =
  | { kind: "idle" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "downloading"; percent: number };

export default function UpdatePrompt() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) return;
    checkForUpdate()
      .then((update) => {
        if (!cancelled && update) setPhase({ kind: "available", update });
      })
      .catch(() => {
        /* silent no-op — offline or no feed */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase.kind === "idle") return null;

  const box: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    margin: "0.75rem 0.75rem 0",
    padding: "0.6rem 0.9rem",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    fontSize: "0.875rem",
    color: "#14532d",
  };

  if (phase.kind === "downloading") {
    return (
      <div style={box}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>
            Downloading update&hellip; {phase.percent}%
          </div>
          <div
            style={{
              marginTop: 6,
              height: 6,
              background: "#dcfce7",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${phase.percent}%`,
                height: "100%",
                background: "#16a34a",
                transition: "width 0.2s",
              }}
            />
          </div>
          <div style={{ marginTop: 4, fontSize: "0.8rem" }}>
            The app will restart when the update is ready.
          </div>
        </div>
      </div>
    );
  }

  const startUpdate = async () => {
    setPhase({ kind: "downloading", percent: 0 });
    try {
      await installUpdate((percent) =>
        setPhase({ kind: "downloading", percent })
      );
    } catch {
      // Plugin found no update, or the download failed: hide silently
      // rather than alarming the till — the user can try again next launch.
      setPhase({ kind: "idle" });
    }
  };

  return (
    <div style={box}>
      <span aria-hidden="true" style={{ fontSize: "1rem", lineHeight: 1.2 }}>
        {"\u{1F504}"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          A new version is ready &mdash; v{phase.update.version}
        </div>
        {phase.update.notes ? (
          <div style={{ marginTop: 2 }}>{phase.update.notes}</div>
        ) : null}
        <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={startUpdate}
            style={{
              padding: "0.3rem 0.9rem",
              background: "#16a34a",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 700,
            }}
          >
            Update now
          </button>
          <button
            type="button"
            onClick={() => setPhase({ kind: "idle" })}
            style={{
              padding: "0.3rem 0.9rem",
              background: "transparent",
              color: "#14532d",
              border: "1px solid #86efac",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
