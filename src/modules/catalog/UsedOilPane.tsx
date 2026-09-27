import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbTransaction } from "../../lib/db";
import { Modal } from "../../components/Modal";
import { FormField } from "../../components/FormField";
import { EmptyState } from "../../components/EmptyState";
import { cardParts, type Column } from "./columns";
import { Pane } from "./Pane";
import EntityTable from "./EntityTable";
import EntityGrid from "./EntityGrid";
import type { Density, ViewMode } from "./prefs";

interface Props {
  view: ViewMode;
  density: Density;
  columns: Column[];
  search: string;
  compact: boolean;
  onViewAll?: () => void;
}

export default function UsedOilPane({ view, density, columns, search, compact, onViewAll }: Props) {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<"collected" | "disposed">("collected");
  const [form, setForm] = useState({ litres: "", notes: "" });

  const { data: drum } = useQuery({ queryKey: ["catalog_drum"], queryFn: () => dbSelect<any>("SELECT * FROM used_oil_drum WHERE id = 1").then((r) => r[0]) });
  const { data: rows, isLoading } = useQuery({
    queryKey: ["catalog_uo_log"],
    queryFn: () => dbSelect<any>("SELECT * FROM used_oil_log ORDER BY created_at DESC LIMIT 200"),
  });

  const current = drum?.current_litres ?? 0;
  const pct = drum ? Math.round((current / (drum.capacity || 200)) * 100) : 0;

  function close() { setShow(false); setForm({ litres: "", notes: "" }); }

  const record = useMutation({
    mutationFn: async () => {
      const l = parseFloat(form.litres);
      if (!l || l <= 0) throw new Error("Enter litres greater than 0");
      if (mode === "disposed" && l > current) throw new Error(`Only ${current.toFixed(1)} L in the drum`);
      const litres = mode === "disposed" ? -l : l;
      await dbTransaction([
        { sql: "UPDATE used_oil_drum SET current_litres = current_litres + $1 WHERE id = 1", params: [litres] },
        { sql: "INSERT INTO used_oil_log (drum_id, litres, type, notes) VALUES (1, $1, $2, $3)", params: [litres, mode, form.notes || (mode === "collected" ? "Drop-off" : "")] },
      ]);
    },
    onSuccess: () => { qc.invalidateQueries(); close(); },
    onError: (e: any) => alert("Error: " + (e?.message || e)),
  });

  const all = (rows ?? []).filter((r: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (r.notes ?? "").toLowerCase().includes(s) || (r.type ?? "").toLowerCase().includes(s);
  });
  const shown = compact ? all.slice(0, 6) : all;
  const { title, cards } = cardParts("used_oil", columns);

  const open = (m: "collected" | "disposed") => { setMode(m); setForm({ litres: "", notes: "" }); setShow(true); };

  const levelTool = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.72rem", color: "#64748b" }}>
      <span style={{ width: 60, height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.min(pct, 100)}%`, background: pct > 90 ? "#dc2626" : pct > 70 ? "#d97706" : "#16a34a" }} />
      </span>
      {current.toFixed(1)} L
    </span>
  );

  return (
    <Pane
      icon="◔" label="Used Oil Drum" count={all.length}
      tools={<>{levelTool}{compact && all.length > 6 && onViewAll ? <button className="btn btn-ghost btn-sm" onClick={onViewAll}>View all →</button> : null}</>}
      action={
        <div style={{ display: "flex", gap: 4 }}>
          <button className="btn btn-primary btn-sm" onClick={() => open("collected")}>+ Collect</button>
          <button className="btn btn-ghost btn-sm" onClick={() => open("disposed")}>Dispose</button>
        </div>
      }
    >
      {view === "grid" ? (
        <EntityGrid title={title} columns={cards} rows={shown} density={density} loading={isLoading}
          isDimmed={(r) => (r.litres ?? 0) < 0}
          empty={<EmptyState title="No records" message="Record a collection to get started" />} />
      ) : (
        <EntityTable columns={columns} rows={shown} density={density} loading={isLoading}
          isDimmed={(r) => (r.litres ?? 0) < 0}
          empty={<EmptyState title="No records" message="Record a collection to get started" />} />
      )}

      {show && (
        <Modal title={mode === "collected" ? "Record Collection" : "Record Disposal"} onClose={close}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
              Drum currently holds <strong>{current.toFixed(1)} L</strong> of {(drum?.capacity ?? 200).toFixed(0)} L capacity
            </div>
            <FormField label="Litres *"><input className="input" type="number" step="any" min="0" autoFocus value={form.litres} onChange={(e) => setForm({ ...form, litres: e.target.value })} /></FormField>
            <FormField label="Notes"><input className="input" placeholder={mode === "collected" ? "e.g. Customer drop-off" : ""} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FormField>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => record.mutate()} disabled={!form.litres || record.isPending}>
              {record.isPending ? "Saving…" : mode === "collected" ? "Record Collection" : "Record Disposal"}
            </button>
            <button className="btn btn-ghost" onClick={close}>Cancel</button>
          </div>
        </Modal>
      )}
    </Pane>
  );
}
