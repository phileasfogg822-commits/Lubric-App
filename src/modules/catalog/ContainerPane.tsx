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

const STATUSES = ["all", "full", "opened", "empty"] as const;

export default function ContainerPane({ view, density, columns, search, compact, onViewAll }: Props) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("all");
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ product_id: "", original_volume: "" });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["catalog_containers", status, search],
    queryFn: () => {
      let sql = "SELECT c.*, p.name as product_name FROM containers c JOIN products p ON c.product_id = p.id";
      const where: string[] = [];
      const params: any[] = [];
      if (status !== "all") { params.push(status); where.push(`c.status = $${params.length}`); }
      if (search) { params.push(`%${search}%`); where.push(`p.name ILIKE $${params.length}`); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      return dbSelect<any>(sql + " ORDER BY c.opened_at DESC NULLS LAST, c.id DESC", params);
    },
  });

  const { data: products } = useQuery({ queryKey: ["products_list"], queryFn: () => dbSelect<any>("SELECT id, name FROM products WHERE active = 1 ORDER BY name") });

  const openContainer = useMutation({
    mutationFn: async () => {
      const productId = parseInt(form.product_id);
      const vol = parseFloat(form.original_volume);
      if (!productId || !vol || vol <= 0) throw new Error("Enter a product and a volume greater than 0");
      await dbExecute("INSERT INTO containers (product_id, original_volume, remaining_volume, status) VALUES ($1, $2, $3, 'full')", [productId, vol, vol]);
    },
    onSuccess: () => { qc.invalidateQueries(); setShow(false); setForm({ product_id: "", original_volume: "" }); },
    onError: (e: any) => alert("Error opening container: " + (e?.message || e)),
  });

  const markEmpty = useMutation({
    mutationFn: async (r: any) => { await dbExecute("UPDATE containers SET status='empty', remaining_volume=0 WHERE id=$1", [r.id]); },
    onSuccess: () => qc.invalidateQueries(),
  });

  const all = rows ?? [];
  const shown = compact ? all.slice(0, 6) : all;
  const { title, cards } = cardParts("containers", columns);

  const filterTools = (
    <div style={{ display: "flex", gap: 4 }}>
      {STATUSES.map((s) => (
        <button key={s} className={`btn btn-sm ${status === s ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }} onClick={() => setStatus(s)}>
          {s === "all" ? "All" : s}
        </button>
      ))}
    </div>
  );

  const rowActions = (r: any) => r.status !== "empty" ? (
    <button className="btn btn-ghost btn-sm" onClick={() => markEmpty.mutate(r)}>Mark empty</button>
  ) : null;

  return (
    <Pane
      icon="◌" label="Containers" count={all.length}
      tools={<>{filterTools}{compact && all.length > 6 && onViewAll ? <button className="btn btn-ghost btn-sm" onClick={onViewAll}>View all →</button> : null}</>}
      action={<button className="btn btn-primary btn-sm" onClick={() => setShow(true)}>+ Open Container</button>}
    >
      {view === "grid" ? (
        <EntityGrid title={title} columns={cards} rows={shown} density={density} loading={isLoading}
          actions={rowActions} isDimmed={(r) => r.status === "empty"}
          empty={<EmptyState title="No containers" message="Open a container to get started" />} />
      ) : (
        <EntityTable columns={columns} rows={shown} density={density} loading={isLoading}
          actions={rowActions} actionsLabel="Actions" isDimmed={(r) => r.status === "empty"}
          empty={<EmptyState title="No containers" message="Open a container to get started" />} />
      )}

      {show && (
        <Modal title="Open New Container" onClose={() => setShow(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <FormField label="Product *">
              <select className="input" value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                <option value="">— Select product —</option>
                {products?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <FormField label="Volume (L) *"><input className="input" type="number" step="any" placeholder="e.g. 20" value={form.original_volume} onChange={(e) => setForm({ ...form, original_volume: e.target.value })} /></FormField>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => openContainer.mutate()} disabled={!form.product_id || !form.original_volume || openContainer.isPending}>
              {openContainer.isPending ? "Opening…" : "Open Container"}
            </button>
            <button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </Pane>
  );
}