import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "../../lib/db";
import { currency } from "../../lib/format";
import { Modal } from "../../components/Modal";
import { loadOrder, loadOrderItems, saveOrderEdits, leftoverLitresFor, type OrderRow, type EditLine } from "./editSale";
import { packLitres, effectiveUnitPrice, tierPrice } from "../pos/POSCart";
import type { Product, CustomerType } from "../../lib/types";

interface Row extends EditLine { key: string; pack: number; capacity: number }

export default function EditButton({ orderId, onDone }: { orderId: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [mileage, setMileage] = useState(0);
  const [notes, setNotes] = useState("");
  const [paid, setPaid] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const { data: products } = useQuery({
    queryKey: ["sales_edit_products"],
    queryFn: () => dbSelect<Product>("SELECT * FROM products ORDER BY name"),
    enabled: open,
  });
  const { data: customers } = useQuery({
    queryKey: ["sales_edit_customers"],
    queryFn: () => dbSelect<any>("SELECT id, name, customer_type FROM customers ORDER BY name"),
    enabled: open,
  });

  async function load() {
    setErr("");
    try {
      const o = await loadOrder(orderId);
      if (!o) throw new Error("Order not found");
      const items = await loadOrderItems(orderId);
      const prodById = new Map((products ?? []).map((p) => [p.id, p]));
      setOrder(o);
      setCustomerId(o.customer_id);
      setMileage(o.mileage ?? 0);
      setNotes(o.notes ?? "");
      setPaid(Number(o.paid_amount) || 0);
      setRows(items.map((it) => {
        const p = it.kind === "product" ? prodById.get(it.ref_id) : undefined;
        const pack = p ? packLitres(p) : 0;
        return {
          key: `x${it.id}`, id: it.id, kind: it.kind, ref_id: it.ref_id, name: it.name,
          qty: it.qty, unit_price: it.unit_price, line_total: it.line_total,
          container_id: it.container_id, capacity: it.capacity ?? 0,
          billedByCapacity: it.billed_by_capacity, pack,
          leftoverLitres: it.leftover_litres ?? 0,
          leftoverTo: (it.leftover_to as "container" | "customer") ?? "container",
        };
      }));
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { if (open) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, products]);

  const custType: CustomerType = useMemo(
    () => (customers?.find((c) => c.id === customerId)?.customer_type as CustomerType) || "returning",
    [customers, customerId]);

  function setRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => {
      if (r.key !== key) return r;
      const n = { ...r, ...patch };
      if (n.kind === "product") {
        const p = (products ?? []).find((x) => x.id === n.ref_id);
        if (p) {
          if (patch.qty !== undefined || patch.capacity !== undefined || patch.billedByCapacity !== undefined || patch.ref_id !== undefined) {
            n.unit_price = effectiveUnitPrice(
              { kind: "product", billByCapacity: n.billedByCapacity, capacity: n.capacity } as any,
              tierPrice(p, custType, n.qty));
          }
          n.leftoverLitres = leftoverLitresFor(n.pack || packLitres(p), n.capacity);
        }
      }
      n.line_total = Math.round(n.unit_price * n.qty * 100) / 100;
      return n;
    }));
  }

  function addProduct(pid: number) {
    const p = (products ?? []).find((x) => x.id === pid);
    if (!p) return;
    const cap = 0;
    const u = tierPrice(p, custType, 1);
    setRows((rs) => [...rs, {
      key: `n${Date.now()}`, kind: "product", ref_id: p.id, name: p.name, qty: 1,
      unit_price: u, line_total: u, container_id: null, capacity: cap,
      billedByCapacity: false, pack: packLitres(p),
      leftoverLitres: leftoverLitresFor(packLitres(p), cap), leftoverTo: "container",
    }]);
  }

  const total = useMemo(() => Math.round(rows.reduce((s, r) => s + (Number(r.line_total) || 0), 0) * 100) / 100, [rows]);

  async function save() {
    setBusy(true); setErr("");
    try {
      await saveOrderEdits(orderId, rows.map(({ key, pack, ...l }) => l as EditLine), { customerId, mileage, notes, paidAmount: paid });
      setOpen(false);
      onDone();
    } catch (e: any) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }

  if (!open) return <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Edit</button>;

  return (
    <Modal title={`Edit Order #${orderId}`} onClose={() => setOpen(false)} wide>
      {err && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: "0.8rem" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <select className="input" value={customerId ?? ""} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)} style={{ width: 180 }}>
          <option value="">Walk-in (no customer)</option>
          {(customers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="input" type="number" placeholder="Mileage" value={mileage || ""} onChange={(e) => setMileage(Number(e.target.value) || 0)} style={{ width: 100 }} />
        <input className="input" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <input className="input" type="number" placeholder="Paid" value={paid} onChange={(e) => setPaid(Number(e.target.value) || 0)} style={{ width: 110 }} title="Amount collected — less than the total records credit (udhaar)" />
      </div>

      <table className="table" style={{ fontSize: "0.8rem" }}>
        <thead><tr><th>Item</th><th style={{ width: 70 }}>Qty</th><th style={{ width: 90 }}>Price</th>
          <th style={{ width: 90 }}>Capacity L</th><th style={{ width: 60 }}>By cap.</th>
          <th style={{ width: 110 }}>Leftover</th><th style={{ textAlign: "right", width: 90 }}>Line</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.name}</td>
              <td><input className="input" type="number" step="0.01" value={r.qty} style={{ padding: "2px 6px" }}
                onChange={(e) => setRow(r.key, { qty: parseFloat(e.target.value) || 0 })} /></td>
              <td><input className="input" type="number" step="0.01" value={r.unit_price} style={{ padding: "2px 6px" }}
                onChange={(e) => setRow(r.key, { unit_price: parseFloat(e.target.value) || 0 })} /></td>
              <td>{r.kind === "product" ? (
                <input className="input" type="number" step="0.01" value={r.capacity || ""} placeholder={`pack ${r.pack || "?"}L`}
                  style={{ padding: "2px 6px" }} onChange={(e) => setRow(r.key, { capacity: parseFloat(e.target.value) || 0 })} />
              ) : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
              <td>{r.kind === "product" ? (
                <input type="checkbox" checked={r.billedByCapacity === true}
                  onChange={(e) => setRow(r.key, { billedByCapacity: e.target.checked })} title="Bill pro-rata for the litres the engine took" />
              ) : null}</td>
              <td>{r.kind === "product" ? (
                <select className="input" value={r.leftoverTo} style={{ padding: "2px 6px" }}
                  onChange={(e) => setRow(r.key, { leftoverTo: e.target.value as "container" | "customer" })}>
                  <option value="container">→ containers ({r.leftoverLitres}L)</option>
                  <option value="customer">→ customer</option>
                </select>
              ) : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{currency(r.line_total)}</td>
              <td><button className="btn btn-ghost btn-sm" style={{ color: "#dc2626", padding: "0 4px" }}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select className="input" value="" onChange={(e) => { if (e.target.value) addProduct(Number(e.target.value)); }} style={{ width: 220, fontSize: "0.8rem" }}>
          <option value="">+ Add product line...</option>
          {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span style={{ marginLeft: "auto", fontWeight: 700 }}>
          Total {currency(total)}
          {Math.abs(total - (order?.total ?? 0)) > 0.004 && (
            <span style={{ fontSize: "0.75rem", color: "#dc2626", fontWeight: 400 }}> (was {currency(order?.total ?? 0)})</span>
          )}
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy || rows.length === 0}>
          {busy ? "Saving..." : "Save Changes"}
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        <span style={{ fontSize: "0.72rem", color: "#94a3b8", alignSelf: "center" }}>
          Stock, accounts ledger and leftover containers are adjusted automatically.
        </span>
      </div>
    </Modal>
  );
}
