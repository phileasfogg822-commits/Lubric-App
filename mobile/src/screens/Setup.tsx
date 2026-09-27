import { useState } from "react";

export default function Setup({ serverUrl, onDone }: { serverUrl: string; onDone: (url: string, code: string) => Promise<void> }) {
  const [url, setUrl] = useState(serverUrl);
  const [code, setCode] = useState("");
  const [name, setName] = useState("Field phone");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setBusy(true); setErr("");
    try { await onDone(url, code); }
    catch (e: any) { setErr(e.message || "Pairing failed"); }
    setBusy(false);
  }

  return (
    <div className="center pad">
      <h1 className="title">LUBRIC FIELD</h1>
      <p className="hint">Finances companion — collections, cash handovers &amp; reservations.</p>
      <label className="lbl">Server URL</label>
      <input className="inp" placeholder="http://72.61.115.120:9000" value={url} onChange={(e) => setUrl(e.target.value)} />
      <label className="lbl">Pairing code</label>
      <input className="inp" placeholder="e.g. A3F9C2D1" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
      <label className="lbl">Device name</label>
      <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <button className="primary" onClick={go} disabled={busy || !url || !code}>
        {busy ? "Pairing…" : "Pair device"}
      </button>
      <p className="hint">Get the code from the shop owner: <code>node pair.js mobile "phone"</code></p>
    </div>
  );
}
