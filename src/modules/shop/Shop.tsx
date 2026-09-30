import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbExecute } from "../../lib/db";
import { getCloudBase, setCloudBase } from "../../lib/cloud";
import { pairDevice, getSyncStatus, onSyncStatus, syncNow } from "../../lib/sync";
import { getLocalDb } from "../../lib/db";
import { d } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { PERMISSIONS, isAdminRole } from "../../lib/permissions";
import {
  canManageDevices,
  createPairingCode,
  countPhones,
  listDevices,
  requestDeviceSync,
  revokeDevice,
  type Device,
  type PendingCode,
} from "../../lib/pairing";
import { Page } from "../../components/Page";
import { FormField } from "../../components/FormField";

/**
 * "How many phones are connected" in one line.
 *
 * The device table below answers the same question in detail, but it scrolls
 * out of sight and the owner asked for the count to be visible at a glance -
 * paired phones are the ones that can actually collect and sync right now.
 */
function PhoneCountBar({ devices }: { devices: Device[] }) {
  const { paired, waiting } = countPhones(devices);
  const desktops = devices.filter((x) => x.kind === "desktop" && x.status === "paired").length;
  const stale = devices.filter(
    (x) =>
      x.kind === "mobile" &&
      x.status === "paired" &&
      !!x.sync_requested_at
  ).length;

  return (
    <div
      style={{
        display: "flex",
        gap: 18,
        flexWrap: "wrap",
        alignItems: "center",
        padding: "10px 12px",
        marginTop: 12,
        borderRadius: 8,
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
      }}
    >
      <span style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0f172a" }}>
        {paired}
      </span>
      <span style={{ fontSize: "0.8rem", color: "#475569" }}>
        phone{paired === 1 ? "" : "s"} connected
      </span>
      {waiting > 0 && (
        <span className="badge badge-yellow" style={{ fontSize: "0.7rem" }}>
          {waiting} waiting to pair
        </span>
      )}
      {stale > 0 && (
        <span className="badge badge-blue" style={{ fontSize: "0.7rem" }}>
          {stale} asked to sync
        </span>
      )}
      {desktops > 0 && (
        <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
          {desktops} desktop{desktops === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

export default function Shop() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [cloudUrl, setCloudUrl] = useState(() => getCloudBase() ?? "");
  const [pairingCode, setPairingCode] = useState("");
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  useEffect(() => onSyncStatus((s, err) => setSyncStatus({ status: s, lastError: err, lastSyncAt: syncStatus.lastSyncAt })), []);
  const [s, setS] = useState({ name: "LubricApp", address: "", phone: "", currency: "PKR", used_oil_drum_capacity: 200, manual_price_allowed: true, wholesale_mode: "auto" });

  // Issuing a pairing code hands out a permanent sync token, so it is gated on
  // the same permission the server enforces on the devices table.
  const canPair = isAdminRole(user?.role) || (user?.permissions as string[] | undefined)?.includes(PERMISSIONS.TEAM_MANAGE);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [issued, setIssued] = useState<PendingCode | null>(null);
  const [pairError, setPairError] = useState("");

  const devicesQ = useQuery({
    queryKey: ["devices"],
    queryFn: listDevices,
    enabled: canPair && canManageDevices(),
  });
  const addDevice = useMutation({
    mutationFn: () => createPairingCode(newDeviceName, "mobile"),
    onSuccess: (code) => { setIssued(code); setNewDeviceName(""); setPairError(""); qc.invalidateQueries({ queryKey: ["devices"] }); },
    onError: (e: any) => setPairError(e?.message || String(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: number) => revokeDevice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
    onError: (e: any) => setPairError(e?.message || String(e)),
  });
  const fetchFromPhone = useMutation({
    mutationFn: (id: number) => requestDeviceSync(id),
    onSuccess: () => {
      setPairError("");
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e: any) => setPairError(e?.message || String(e)),
  });
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

      {canPair && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Phones &amp; Devices</div>
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginBottom: 12 }}>
            Add as many phones as you like. Press <b>Add a phone</b>, then type the code it shows
            into that phone on its first screen. The code works once and only once.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="input"
              style={{ width: 200 }}
              placeholder="Phone name (optional)"
              value={newDeviceName}
              onChange={(e) => setNewDeviceName(e.target.value)}
            />
            <button
              className="btn btn-primary"
              onClick={() => addDevice.mutate()}
              disabled={addDevice.isPending}
            >
              {addDevice.isPending ? "Creating…" : "+ Add a phone"}
            </button>
            {pairError && <span style={{ color: "#b91c1c", fontSize: "0.8rem" }}>{pairError}</span>}
          </div>

          {issued && (
            <div
              style={{
                marginTop: 14,
                padding: 16,
                borderRadius: 8,
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
              }}
            >
              <div style={{ fontSize: "0.8rem", color: "#1e40af" }}>
                Pairing code for <b>{issued.name}</b> — type this into the phone:
              </div>
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "2rem",
                  fontWeight: 800,
                  letterSpacing: "0.25em",
                  color: "#1e3a8a",
                  margin: "6px 0",
                }}
              >
                {issued.code}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(issued.code);
                    setPairError("");
                  }}
                >
                  Copy code
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setIssued(null)}>
                  Done
                </button>
                <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                  Shown once. If you lose it, revoke the phone below and add it again.
                </span>
              </div>
            </div>
          )}

          {!canManageDevices() ? (
            <div className="alert alert-success" style={{ marginTop: 12 }}>
              This desktop is running offline, so it cannot reach the shop server. Connect to the
              cloud (above) to see the phones attached to this shop.
            </div>
          ) : devicesQ.isLoading ? (
            <div style={{ padding: 12, color: "#64748b" }}>Loading devices…</div>
          ) : devicesQ.data?.length ? (
            <>
              <PhoneCountBar devices={devicesQ.data} />
              <table className="table" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Last sync</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {devicesQ.data.map((dv: Device) => (
                    <tr key={dv.id}>
                      <td style={{ fontWeight: 500 }}>{dv.name || `Device #${dv.id}`}</td>
                      <td>{dv.kind === "mobile" ? "Phone" : "Desktop"}</td>
                      <td>
                        <span
                          className={`badge ${
                            dv.status === "paired" ? "badge-green" : dv.status === "waiting" ? "badge-yellow" : "badge-gray"
                          }`}
                        >
                          {dv.status === "paired" ? "Paired" : dv.status === "waiting" ? "Waiting for setup" : "Revoked"}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.8rem", color: "#64748b" }}>
                        {dv.last_sync_at ? d(dv.last_sync_at) : "never"}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {dv.kind === "mobile" && dv.status === "paired" && (
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Ask this phone to send its data now. The phone does this the next time it has a connection."
                            disabled={fetchFromPhone.isPending || !!dv.sync_requested_at}
                            onClick={() => fetchFromPhone.mutate(dv.id)}
                          >
                            {dv.sync_requested_at ? "Asked ✓" : "Fetch data"}
                          </button>
                        )}
                        {dv.status !== "revoked" && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              if (confirm(`Remove "${dv.name || "this device"}"?\n\nIt stops syncing immediately. Use this if the phone is lost or sold.`)) {
                                revoke.mutate(dv.id);
                              }
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div style={{ padding: 12, fontSize: "0.8rem", color: "#64748b" }}>
              No phones attached yet.
            </div>
          )}
        </div>
      )}

      <button className="btn btn-primary" onClick={() => save.mutate()}>Save Settings</button>
    </Page>
  );
}
