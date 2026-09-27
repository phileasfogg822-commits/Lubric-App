import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbExecute } from "../../lib/db";
import { getCloudBase, setCloudBase } from "../../lib/cloud";
import { pairDevice, getSyncStatus, onSyncStatus, syncNow } from "../../lib/sync";
import { getLocalDb } from "../../lib/db";
import { Page } from "../../components/Page";
import { FormField } from "../../components/FormField";

export default function Shop() {
  const qc = useQueryClient();
  const [cloudUrl, setCloudUrl] = useState(() => getCloudBase() ?? "");
  const [pairingCode, setPairingCode] = useState("");
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  useEffect(() => onSyncStatus((s, err) => setSyncStatus({ status: s, lastError: err, lastSyncAt: syncStatus.lastSyncAt })), []);
  const [s, setS] = useState({ name: "LubricApp", address: "", phone: "", currency: "PKR", used_oil_drum_capacity: 200, manual_price_allowed: true, wholesale_mode: "auto" });
  const { data: settings } = useQuery({ queryKey: ["shop_settings"], queryFn: () => dbSelect<any>("SELECT * FROM settings").then(r => { const obj: any = {}; r.forEach((row: any) => { obj[row.key] = row.value; }); return obj; }) });
  // Bills (POSPrint/Reports) read name/address/phone/currency straight from the
  // shops table, so prefill the form from it and mirror edits back on save.
  const { data: shopRow } = useQuery({ queryKey: ["shop_row"], queryFn: () => dbSelect<any>("SELECT name, address, phone, currency FROM shops WHERE id = 1") });
  useEffect(() => {
    const r = shopRow?.[0];
    if (!r) return;
    setS((prev) => ({ ...prev, name: r.name || prev.name, address: r.address ?? prev.address, phone: r.phone ?? prev.phone, currency: r.currency || prev.currency }));
  }, [shopRow]);
  const save = useMutation({
    mutationFn: async () => {
      for (const [k, v] of Object.entries(s)) await dbExecute("INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)", [k, String(v)]);
      await dbExecute("UPDATE shops SET name=$1, address=$2, phone=$3, currency=$4 WHERE id=1", [s.name, s.address, s.phone, s.currency]);
      if (s.used_oil_drum_capacity) await dbExecute("UPDATE used_oil_drum SET capacity=$1 WHERE id=1", [s.used_oil_drum_capacity]);
    },
    onSuccess: () => { qc.invalidateQueries(); alert("Settings saved!"); },
  });
  return (
    <Page title="Shop Settings">
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Business Info</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <FormField label="Shop Name"><input className="input" value={s.name} onChange={e => setS({ ...s, name: e.target.value })} /></FormField>
          <FormField label="Address"><textarea className="input" value={s.address} onChange={e => setS({ ...s, address: e.target.value })} rows={2} /></FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FormField label="Phone"><input className="input" value={s.phone} onChange={e => setS({ ...s, phone: e.target.value })} /></FormField>
            <FormField label="Currency"><select className="input" value={s.currency} onChange={e => setS({ ...s, currency: e.target.value })}><option value="PKR">PKR (Rs)</option><option value="KES">KES</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></FormField>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>POS Configuration</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <FormField label="Used Oil Drum Capacity (L)"><input className="input" type="number" value={s.used_oil_drum_capacity} onChange={e => setS({ ...s, used_oil_drum_capacity: parseInt(e.target.value) || 200 })} /></FormField>
          <FormField label="Wholesale Mode"><select className="input" value={s.wholesale_mode} onChange={e => setS({ ...s, wholesale_mode: e.target.value })}><option value="auto">Auto</option><option value="manual">Manual</option></select></FormField>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={s.manual_price_allowed} onChange={e => setS({ ...s, manual_price_allowed: e.target.checked })} /> Allow manual price entry</label>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Cloud &amp; Sync</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <FormField label="Cloud server URL (VPS)">
            <input className="input" placeholder="https://api.yourdomain.com" value={cloudUrl}
              onChange={e => setCloudUrl(e.target.value)} />
          </FormField>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-ghost" onClick={() => { setCloudBase(cloudUrl); alert("Cloud URL saved."); }}>Save URL</button>
            <input className="input" placeholder="Pairing code" value={pairingCode} onChange={e => setPairingCode(e.target.value)} style={{ width: 140 }} />
            <button className="btn btn-ghost" onClick={async () => {
              try { await pairDevice(pairingCode, "Desktop"); setPairingCode(""); alert("Device paired — sync is live."); }
              catch (e: any) { alert(e.message || "Pairing failed"); }
            }} disabled={!pairingCode}>Pair device</button>
            <button className="btn btn-primary" onClick={async () => {
              try {
                const db = await getLocalDb();
                const r = await syncNow(db);
                alert(`Synced: ${r.pushed} pushed, ${r.pulled} pulled${r.rejected ? `, ${r.rejected} rejected` : ""}.`);
              } catch (e: any) { alert(e.message || "Sync failed"); }
            }}>Sync now</button>
            <span style={{ fontSize: "0.78rem", color: "#64748b" }}>Status: {syncStatus.status}{syncStatus.lastError ? ` — ${syncStatus.lastError}` : ""}</span>
          </div>
        </div>
      </div>
      <button className="btn btn-primary" onClick={() => save.mutate()}>Save Settings</button>
    </Page>
  );
}
