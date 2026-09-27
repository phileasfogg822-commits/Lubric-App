import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbExecute } from "../lib/db";
import { Modal } from "./Modal";
import { FormField } from "./FormField";
import { REMINDER_KINDS } from "../lib/reminders";
import type { ReminderKind, ReminderPriority } from "../lib/types";

export interface ReminderDraft {
  id?: number;
  kind?: ReminderKind;
  title?: string;
  details?: string;
  due_at?: string | null;
  due_km?: number | null;
  customer_id?: number | null;
  vehicle_id?: number | null;
  vendor_id?: number | null;
  priority?: ReminderPriority;
  recurrence_days?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: ReminderDraft | null;
}

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReminderModal({ open, onClose, initial }: Props) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ReminderKind>("todo");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [dueKm, setDueKm] = useState("");
  const [priority, setPriority] = useState<ReminderPriority>("normal");
  const [recurrence, setRecurrence] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: customers } = useQuery({
    queryKey: ["reminder_customers"],
    queryFn: () => dbSelect<{ id: number; name: string }>("SELECT id, name FROM customers ORDER BY name"),
    enabled: open,
  });
  const { data: vendors } = useQuery({
    queryKey: ["reminder_vendors"],
    queryFn: () => dbSelect<{ id: number; name: string }>("SELECT id, name FROM vendors ORDER BY name"),
    enabled: open,
  });
  const { data: vehicles } = useQuery({
    queryKey: ["reminder_vehicles", customerId],
    queryFn: () =>
      dbSelect<{ id: number; label: string }>(
        `SELECT id, COALESCE(NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', make, model, registration)), ''), 'Vehicle') AS label
         FROM vehicles WHERE customer_id = $1 ORDER BY id DESC`,
        customerId ? [customerId] : []
      ),
    enabled: open && !!customerId,
  });

  useEffect(() => {
    if (!open) return;
    setKind(initial?.kind ?? "todo");
    setTitle(initial?.title ?? "");
    setDetails(initial?.details ?? "");
    setDueLocal(toLocalInput(initial?.due_at));
    setDueKm(initial?.due_km != null ? String(initial.due_km) : "");
    setPriority(initial?.priority ?? "normal");
    setRecurrence(initial?.recurrence_days != null ? String(initial.recurrence_days) : "");
    setCustomerId(initial?.customer_id ?? null);
    setVehicleId(initial?.vehicle_id ?? null);
    setVendorId(initial?.vendor_id ?? null);
  }, [open, initial]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const due = dueLocal ? new Date(dueLocal).toISOString() : null;
      const vals: unknown[] = [
        kind, title.trim(), details.trim(), due,
        dueKm ? Number(dueKm) : null, priority,
        recurrence ? Number(recurrence) : null,
        customerId, vehicleId, vendorId,
      ];
      if (initial?.id) {
        await dbExecute(
          `UPDATE reminders SET kind=$1, title=$2, details=$3, due_at=$4, due_km=$5,
             priority=$6, recurrence_days=$7, customer_id=$8, vehicle_id=$9, vendor_id=$10,
             status = CASE WHEN status = 'done' THEN 'pending' ELSE status END,
             updated_at = now()
           WHERE id = ${Math.trunc(initial.id)}`,
          vals
        );
      } else {
        await dbExecute(
          `INSERT INTO reminders
             (shop_id, kind, title, details, due_at, due_km, priority, recurrence_days,
              customer_id, vehicle_id, vendor_id)
           VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          vals
        );
      }
      await qc.invalidateQueries({ queryKey: ["reminders"] });
      await qc.invalidateQueries({ queryKey: ["reminder_counts"] });
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert("Could not save reminder: " + msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={initial?.id ? "Edit Reminder" : "New Reminder"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <FormField label="Type">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ReminderKind)}>
            {REMINDER_KINDS.map((k) => (
              <option key={k.key} value={k.key}>{k.icon} {k.label}</option>
            ))}
          </select>
        </FormField>

        <FormField label="What should we remember? *">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "vendor_meeting" ? "Meeting with Shell distributor" : "Call back / task…"} />
        </FormField>

        <FormField label="Details">
          <textarea className="input" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Optional notes…" />
        </FormField>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <FormField label={kind === "vendor_meeting" ? "Meeting date & time" : "Due date"}>
            <input className="input" type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} />
          </FormField>
          <FormField label="Due at mileage (km)">
            <input className="input" type="number" min={0} value={dueKm} onChange={(e) => setDueKm(e.target.value)}
              placeholder="e.g. 48000" disabled={kind !== "service_due"} />
          </FormField>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <FormField label="Priority">
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as ReminderPriority)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </FormField>
          <FormField label="Repeat">
            <select className="input" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
              <option value="">Never (one-off)</option>
              <option value="7">Every 7 days</option>
              <option value="30">Every 30 days</option>
              <option value="60">Every 60 days</option>
              <option value="90">Every 90 days</option>
            </select>
          </FormField>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {kind === "vendor_meeting" ? (
            <FormField label="Vendor">
              <select className="input" value={vendorId ?? ""}
                onChange={(e) => setVendorId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— none —</option>
                {vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </FormField>
          ) : (
            <FormField label="Customer">
              <select className="input" value={customerId ?? ""}
                onChange={(e) => { setCustomerId(e.target.value ? Number(e.target.value) : null); setVehicleId(null); }}>
                <option value="">— none —</option>
                {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
          )}
          {kind !== "vendor_meeting" && (
            <FormField label="Vehicle">
              <select className="input" value={vehicleId ?? ""}
                onChange={(e) => setVehicleId(e.target.value ? Number(e.target.value) : null)}
                disabled={!customerId}>
                <option value="">— none —</option>
                {vehicles?.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </FormField>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
          <button className="btn btn-primary" onClick={save} disabled={!title.trim() || saving}>
            {initial?.id ? "Save Changes" : "Set Reminder"}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
