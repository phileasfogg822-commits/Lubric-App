import { useEffect, useState } from "react";
import { isPaired, getServer, syncNow, pairDevice, setServer } from "./api";
import { db, pendingCount } from "./store";
import Dashboard from "./screens/Dashboard";
import Record from "./screens/Record";
import Reservations from "./screens/Reservations";
import Setup from "./screens/Setup";

type Tab = "dashboard" | "record" | "reservations";

export default function App() {
  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(isPaired());
  const [tab, setTab] = useState<Tab>("dashboard");
  const [pending, setPending] = useState(0);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Open local DB on boot.
  useEffect(() => { db().then(() => setReady(true)).catch(() => setReady(true)); }, []);

  // Refresh the pending counter whenever the tab changes.
  useEffect(() => { if (ready) pendingCount().then(setPending); }, [tab, ready, syncMsg]);

  if (!ready) return <div className="center">Loading…</div>;
  if (!paired) {
    return (
      <Setup
        serverUrl={getServer()}
        onDone={async (url: string, code: string, name: string) => {
          setServer(url);
          await pairDevice(code, name || "Field phone");
          setPaired(true);
        }}
      />
    );
  }

  async function doSync() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await syncNow();
      setSyncMsg(`Synced: ${r.pushed} up / ${r.pulled} down${r.rejected ? `, ${r.rejected} rejected` : ""}`);
    } catch (e: any) {
      setSyncMsg(e.message || "Sync failed");
    }
    setSyncing(false);
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">LUBRIC FIELD</span>
        <button className="ghost" onClick={doSync} disabled={syncing}>
          {syncing ? "Syncing…" : pending > 0 ? `Sync (${pending})` : "Sync"}
        </button>
      </header>
      {syncMsg && <div className="syncmsg">{syncMsg}</div>}

      <main className="content">
        {tab === "dashboard" && <Dashboard />}
        {tab === "record" && <Record onSaved={() => setTab("dashboard")} />}
        {tab === "reservations" && <Reservations />}
      </main>

      <nav className="tabbar">
        {([
          ["dashboard", "Finances", "💰"],
          ["record", "Record", "➕"],
          ["reservations", "Reserve", "📋"],
        ] as [Tab, string, string][]).map(([t, label, icon]) => (
          <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
            <span className="ic">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
