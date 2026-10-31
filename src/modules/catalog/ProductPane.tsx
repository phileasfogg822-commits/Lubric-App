import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbExecute, dbTransaction } from "../../lib/db";
import { stockStatements } from "../../lib/stock";
import { newUuid } from "../../lib/uuid";
import { Modal } from "../../components/Modal";
import { FormField } from "../../components/FormField";
import { EmptyState } from "../../components/EmptyState";
import { cardParts, type Column } from "./columns";
import { Pane } from "./Pane";
import EntityTable from "./EntityTable";
import EntityGrid from "./EntityGrid";
import type { Density, ViewMode } from "./prefs";

const EMPTY = {
  name: "", category_id: "", brand_id: "", vendor_id: "", variant: "", packing: "", unit: "piece",
  mfd_date: "", exp_date: "", received_date: "", offer: "",
  price_returning: "", price_walking: "", price_wholesale: "",
  wholesale_min_qty: "10", stock_qty: "0", low_stock_threshold: "5",
};

interface Props {
  view: ViewMode;
  density: Density;
  columns: Column[];
  search: string;
  compact: boolean;
  onViewAll?: () => void;
}

export default function ProductPane({ view, density, columns, search, compact, onViewAll }: Props) {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => dbSelect<any>("SELECT id, name FROM categories ORDER BY name") });
  const { data: brands } = useQuery({ queryKey: ["brands"], queryFn: () => dbSelect<any>("SELECT id, name FROM brands ORDER BY name") });
  const { data: vendors } = useQuery({ queryKey: ["vendors_list"], queryFn: () => dbSelect<any>("SELECT id, name FROM vendors ORDER BY name") });
  const [newCategory, setNewCategory] = useState("");
  const [newBrand, setNewBrand] = useState("");

  // Inline master-list creation (added 2026-10-31): there was no screen at
  // all that could add a category or brand, so the product form's dropdowns
  // stayed empty on a fresh phone. Typing a name here creates it and
  // selects it at once; an existing name (case-insensitive) is reused
  // instead of duplicated. On the phone the row queues for sync; it lands
  // on the server once the server's sync list includes these tables (the
  // repo change ships with this, the live server picks it up on redeploy).
  async function addList(table: "categories" | "brands", name: string, key: "categories" | "brands", setFormKey: "category_id" | "brand_id", clear: () => void) {
    const nm = name.trim();
    if (!nm) return;
    try {
      const existing = await dbSelect<any>(`SELECT id FROM ${table} WHERE LOWER(name) = LOWER($1) LIMIT 1`, [nm]);
      if (existing.length) {
        setForm(f => ({ ...f, [setFormKey]: String(existing[0].id) }));
      } else {
        const r = await dbExecute(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id`, [nm]);
        const id = (r.rows?.[0] as { id?: number } | undefined)?.id;
        if (id != null) setForm(f => ({ ...f, [setFormKey]: String(id) }));
      }
      await qc.invalidateQueries({ queryKey: [key] });
      clear();
    } catch (e: any) {
      alert(`Could not add ${table.slice(0, -1)}: ` + (e?.message || e));
    }
  }

  const { data: rows, isLoading } = useQuery({
    queryKey: ["catalog_products", search],
    queryFn: () => {
      let sql = `SELECT p.*, c.name as category_name, b.name as brand_name, v.name as vendor_name
                 FROM products p
                 LEFT JOIN categories c ON p.category_id = c.id
                 LEFT JOIN brands b ON p.brand_id = b.id
                 LEFT JOIN vendors v ON p.vendor_id = v.id`;
      const params: any[] = [];
      if (search) {
        params.push(`%${search}%`);
        sql += ` WHERE p.name ILIKE $1 OR p.sku ILIKE $1 OR p.barcode ILIKE $1`;
      }
      return dbSelect<any>(sql + " ORDER BY p.name", params);
    },
  });

  function close() { setShow(false); setEditId(null); setForm({ ...EMPTY }); }

  const save = useMutation({
    mutationFn: async () => {
      const values: any[] = [
        form.name.trim(),
        form.category_id ? parseInt(form.category_id) : null,
        form.brand_id ? parseInt(form.brand_id) : null,
        form.vendor_id ? parseInt(form.vendor_id) : null,
        form.variant || null,
        form.packing || null,
        form.unit || "piece",
        form.mfd_date || null,
        form.exp_date || null,
        form.received_date || null,
        form.offer || null,
        parseFloat(form.stock_qty || "0"),
        parseFloat(form.low_stock_threshold || "5"),
        parseFloat(form.price_returning || "0"),
        form.price_walking === "" ? null : parseFloat(form.price_walking),
        parseFloat(form.price_wholesale || "0"),
        parseFloat(form.wholesale_min_qty || "10"),
      ];
      if (editId) {
        // Stock is the ONE field on this form that is not a plain column
        // write. Typing a new number here is a physical count, and a count that
        // is not in the ledger is a balance nothing can explain - which is
        // exactly how the real shop's stock drifted away from its own records.
        //
        // So the field set is updated as normal, and the DIFFERENCE is posted as
        // a count_correction movement. Editing a price leaves stock untouched and
        // writes no movement; correcting a count leaves a dated, attributed
        // movement that says the books were changed to match the shelf.
        const nextStock = parseFloat(form.stock_qty || "0");
        const prev = await dbSelect<any>("SELECT stock_qty FROM products WHERE id = $1", [editId]);
        const prevStock = prev.length ? Number(prev[0].stock_qty) || 0 : 0;
        const delta = Math.round((nextStock - prevStock) * 1000) / 1000;

        const stmts: { sql: string; params: unknown[] }[] = [{
          sql: `UPDATE products SET name=$1, category_id=$2, brand_id=$3, vendor_id=$4, variant=$5, packing=$6,
                  unit=$7, mfd_date=$8, exp_date=$9, received_date=$10, offer=$11,
                  low_stock_threshold=$13, price_returning=$14, price_walking=$15, price_wholesale=$16,
                  wholesale_min_qty=$17 WHERE id=$18`,
          params: [values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7],
                   values[8], values[9], values[10], values[12], values[13], values[14], values[15],
                   values[16], editId],
        }];
        if (delta !== 0) {
          stmts.push(
            ...stockStatements({
              itemId: editId,
              kind: "count_correction",
              qty: delta,
              uuid: newUuid(),
              refTable: "products",
              refId: editId,
              note: `Stock counted at ${nextStock}, books said ${prevStock}`,
            })
          );
        }
        await dbTransaction(stmts);
      } else {
        await dbExecute(
          `INSERT INTO products (name, category_id, brand_id, vendor_id, variant, packing, unit,
             mfd_date, exp_date, received_date, offer, stock_qty, low_stock_threshold,
             price_returning, price_walking, price_wholesale, wholesale_min_qty, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1)`,
          values
        );
      }
    },
    onSuccess: () => { qc.invalidateQueries(); close(); },
    onError: (e: any) => alert("Error saving product: " + (e?.message || e)),
  });

  const toggle = useMutation({
    mutationFn: async (r: any) => { await dbExecute("UPDATE products SET active=$1 WHERE id=$2", [r.active ? 0 : 1, r.id]); },
    onSuccess: () => qc.invalidateQueries(),
  });

  function openAdd() { setEditId(null); setForm({ ...EMPTY }); setShow(true); }

  function openEdit(p: any) {
    setEditId(p.id);
    setForm({
      name: p.name ?? "", category_id: p.category_id?.toString() ?? "", brand_id: p.brand_id?.toString() ?? "",
      vendor_id: p.vendor_id?.toString() ?? "", variant: p.variant ?? "", packing: p.packing ?? "",
      unit: p.unit ?? "piece", mfd_date: p.mfd_date ?? "", exp_date: p.exp_date ?? "",
      received_date: p.received_date ?? "", offer: p.offer ?? "",
      price_returning: p.price_returning?.toString() ?? "",
      price_walking: p.price_walking == null ? "" : p.price_walking.toString(),
      price_wholesale: p.price_wholesale?.toString() ?? "",
      wholesale_min_qty: p.wholesale_min_qty?.toString() ?? "10",
      stock_qty: (p.stock_qty ?? 0).toString(), low_stock_threshold: (p.low_stock_threshold ?? 5).toString(),
    });
    setShow(true);
  }
  const all = rows ?? [];
  const shown = compact ? all.slice(0, 6) : all;
  const { title, cards } = cardParts("products", columns);

  const rowActions = (r: any) => (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>Edit</button>
      <button className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(r)}>{r.active ? "Hide" : "Show"}</button>
    </>
  );

  return (
    <Pane
      icon="◈" label="Products" count={all.length}
      tools={compact && all.length > 6 && onViewAll ? <button className="btn btn-ghost btn-sm" onClick={onViewAll}>View all →</button> : undefined}
      action={<button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Product</button>}
    >
      {view === "grid" ? (
        <EntityGrid title={title} columns={cards} rows={shown} density={density} loading={isLoading}
          actions={rowActions} isDimmed={(r) => !r.active}
          empty={<EmptyState title="No products" message="Add your first product" />} />
      ) : (
        <EntityTable columns={columns} rows={shown} density={density} loading={isLoading}
          actions={rowActions} actionsLabel="Actions" isDimmed={(r) => !r.active}
          empty={<EmptyState title="No products" message="Add your first product" />} />
      )}

      {show && (
        <Modal title={editId ? "Edit Product" : "Add Product"} onClose={close} wide>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FormField label="Name *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
            <FormField label="Packing"><input className="input" placeholder="4L / 1kg / 1pc" value={form.packing} onChange={(e) => setForm({ ...form, packing: e.target.value })} /></FormField>
            <FormField label="Company (brand)">
              <select className="input" value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
                <option value="">—</option>
                {brands?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input className="input" placeholder="New company name" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} />
                <button className="btn btn-ghost" onClick={() => addList("brands", newBrand, "brands", "brand_id", () => setNewBrand(""))} disabled={!newBrand.trim()}>Add</button>
              </div>
            </FormField>
            <FormField label="Supplier">
              <select className="input" value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}>
                <option value="">—</option>
                {vendors?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </FormField>
            <FormField label="Category">
              <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">—</option>
                {categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input className="input" placeholder="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
                <button className="btn btn-ghost" onClick={() => addList("categories", newCategory, "categories", "category_id", () => setNewCategory(""))} disabled={!newCategory.trim()}>Add</button>
              </div>
            </FormField>
            <FormField label="Unit"><input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></FormField>
            <FormField label="Variant"><input className="input" value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} /></FormField>
            <FormField label="Offer"><input className="input" value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} /></FormField>
            <FormField label="Mfg date"><input className="input" type="date" value={form.mfd_date} onChange={(e) => setForm({ ...form, mfd_date: e.target.value })} /></FormField>
            <FormField label="Expiry date"><input className="input" type="date" value={form.exp_date} onChange={(e) => setForm({ ...form, exp_date: e.target.value })} /></FormField>
            <FormField label="Date received"><input className="input" type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} /></FormField>
            <FormField label="Stock qty"><input className="input" type="number" step="any" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} /></FormField>
            <FormField label="Returning price"><input className="input" type="number" step="any" value={form.price_returning} onChange={(e) => setForm({ ...form, price_returning: e.target.value })} /></FormField>
            <FormField label="Walk-in price"><input className="input" type="number" step="any" placeholder="blank = same as returning" value={form.price_walking} onChange={(e) => setForm({ ...form, price_walking: e.target.value })} /></FormField>
            <FormField label="Wholesale price"><input className="input" type="number" step="any" value={form.price_wholesale} onChange={(e) => setForm({ ...form, price_wholesale: e.target.value })} /></FormField>
            <FormField label="Wholesale min qty"><input className="input" type="number" step="any" value={form.wholesale_min_qty} onChange={(e) => setForm({ ...form, wholesale_min_qty: e.target.value })} /></FormField>
            <FormField label="Low stock alert"><input className="input" type="number" step="any" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} /></FormField>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}>
              {save.isPending ? "Saving…" : editId ? "Save Changes" : "Add Product"}
            </button>
            <button className="btn btn-ghost" onClick={close}>Cancel</button>
          </div>
        </Modal>
      )}
    </Pane>
  );
}