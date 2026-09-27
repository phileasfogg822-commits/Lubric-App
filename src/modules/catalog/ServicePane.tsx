import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbExecute } from "../../lib/db";
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

export default function ServicePane({ view, density, columns, search, compact, onViewAll }: Props) {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", price: "" });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["catalog_services", search],
    queryFn: () => {
      let sql = "SELECT * FROM services";
      const params: any[] = [];
      if (search) { params.push(`%${search}%`); sql += " WHERE name ILIKE $1"; }
      return dbSelect<any>(sql + " ORDER BY name", params);
    },
  });

  function close() { setShow(false); setEditId(null); setForm({ name: "", price: "" }); }

  const save = useMutation({
    mutationFn: async () => {
      const price = parseFloat(form.price) || 0;
      if (editId) await dbExecute("UPDATE services SET name=$1, price=$2 WHERE id=$3", [form.name.trim(), price, editId]);
      else await dbExecute("INSERT INTO services (name, price, active) VALUES ($1, $2, 1)", [form.name.trim(), price]);
    },
    onSuccess: () => { qc.invalidateQueries(); close(); },
    onError: (e: any) => alert("Error saving service: " + (e?.message || e)),
  });

  const toggle = useMutation({
    mutationFn: async (r: any) => { await dbExecute("UPDATE services SET active=$1 WHERE id=$2", [r.active ? 0 : 1, r.id]); },
    onSuccess: () => qc.invalidateQueries(),
  });

  const all = rows ?? [];
  const shown = compact ? all.slice(0, 6) : all;
  const { title, cards } = cardParts("services", columns);

  const rowActions = (r: any) => (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => { setEditId(r.id); setForm({ name: r.name, price: r.price?.toString() ?? "" }); setShow(true); }}>Edit</button>
      <button className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(r)}>{r.active ? "Hide" : "Show"}</button>
    </>
  );

  return (
    <Pane
      icon="◎" label="Services" count={all.length}
      tools={compact && all.length > 6 && onViewAll ? <button className="btn btn-ghost btn-sm" onClick={onViewAll}>View all →</button> : undefined}
      action={<button className="btn btn-primary btn-sm" onClick={() => { setEditId(null); setForm({ name: "", price: "" }); setShow(true); }}>+ Add Service</button>}
    >
      {view === "grid" ? (
        <EntityGrid title={title} columns={cards} rows={shown} density={density} loading={isLoading}
          actions={rowActions} isDimmed={(r) => !r.active}
          empty={<EmptyState title="No services" message="Add your first service" />} />
      ) : (
        <EntityTable columns={columns} rows={shown} density={density} loading={isLoading}
          actions={rowActions} actionsLabel="Actions" isDimmed={(r) => !r.active}
          empty={<EmptyState title="No services" message="Add your first service" />} />
      )}

      {show && (
        <Modal title={editId ? "Edit Service" : "Add Service"} onClose={close}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <FormField label="Service Name *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
            <FormField label="Price *"><input className="input" type="number" step="any" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></FormField>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => save.mutate()} disabled={!form.name.trim() || form.price === "" || save.isPending}>
              {save.isPending ? "Saving…" : editId ? "Save Changes" : "Add Service"}
            </button>
            <button className="btn btn-ghost" onClick={close}>Cancel</button>
          </div>
        </Modal>
      )}
    </Pane>
  );
}