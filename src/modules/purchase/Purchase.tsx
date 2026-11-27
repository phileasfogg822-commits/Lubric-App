import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { dbSelect, dbGet, dbTransaction } from "../../lib/db";
import { Page } from "../../components/Page";
import { FormField } from "../../components/FormField";
import { EmptyState } from "../../components/EmptyState";
import { newUuid } from "../../lib/uuid";
import {
  buildPurchaseInvoiceStatements,
  purchaseInvoiceTotal,
  purchaseLineTotal,
  purchaseToday,
  validatePurchaseInvoice,
  type NewPurchaseProduct,
  type PurchaseLineInput,
  type ResolvedPurchaseLine,
} from "../../lib/purchase";

interface FormLine {
  key: number;
  productId: number | null;
  newMode: boolean;
  newName: string;
  qty: string;
  unitCost: string;
}

function blankLine(key: number): FormLine {
  return { key, productId: null, newMode: false, newName: "", qty: "", unitCost: "" };
}

const money = (n: number) => Number(n || 0).toLocaleString();

export default function Purchase() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"invoices" | "log">("invoices");
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [savedNote, setSavedNote] = useState("");

  const paramVendor = Number(params.get("vendor") || "") || null;
  const [vendorId, setVendorId] = useState<number | null>(paramVendor);
  const [lines, setLines] = useState<FormLine[]>([blankLine(1)]);
  const [notes, setNotes] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [accountId, setAccountId] = useState<number | null>(null);
  const keyRef = useRef(2);
  // One uuid per form — created when the form opens, stable across retries
  // of that form, so a double-submit 2067s on it instead of adding the
  // stock twice (see lib/purchase.ts). A fresh form gets a fresh uuid.
  const [invoiceUuid, setInvoiceUuid] = useState(() => newUuid());

  const { data: vendors } = useQuery({ queryKey: ["vendors"], queryFn: () => dbSelect<any>("SELECT id, name FROM vendors ORDER BY name") });
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: () => dbSelect<any>("SELECT id, name, cost_price, stock_qty FROM products WHERE active = 1 ORDER BY name") });
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => dbSelect<any>("SELECT id, name, type FROM accounts WHERE active = 1 ORDER BY name") });
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => dbSelect<any>(`SELECT po.id, po.vendor_id, v.name AS vendor_name, po.total, po.paid, po.status, po.notes, po.created_at,
        (SELECT COUNT(*) FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS line_count
      FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id ORDER BY po.id DESC`),
  });
  const { data: logRows } = useQuery({
    queryKey: ["purchase-log"],
    enabled: tab === "log",
    queryFn: () => dbSelect<any>(`SELECT m.id, m.occurred_at, m.qty, m.qty_after, m.note, m.ref_id,
        p.name AS product_name, v.name AS vendor_name
      FROM stock_movements m
      JOIN products p ON p.id = m.item_id
      LEFT JOIN purchase_orders po ON po.id = m.ref_id AND m.ref_table = 'purchase_orders'
      LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE m.kind = 'purchase' ORDER BY m.occurred_at DESC, m.id DESC LIMIT 200`),
  });
  const { data: detail } = useQuery({
    queryKey: ["purchase-detail", detailId],
    enabled: detailId != null,
    queryFn: async () => {
      const head = await dbSelect<any>("SELECT po.*, v.name AS vendor_name FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id WHERE po.id = $1", [detailId]);
      const items = await dbSelect<any>("SELECT i.*, p.name AS product_name FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.purchase_order_id = $1 ORDER BY i.id", [detailId]);
      const moves = await dbSelect<any>("SELECT m.*, p.name AS product_name FROM stock_movements m JOIN products p ON p.id = m.item_id WHERE m.ref_table = 'purchase_orders' AND m.ref_id = $1 ORDER BY m.id", [detailId]);
      return { head: head[0], items, moves };
    },
  });

  const parsedLines: PurchaseLineInput[] = useMemo(() => lines.map((l) => ({
    productId: l.newMode ? null : l.productId,
    newName: l.newMode ? l.newName : "",
    qty: Number(l.qty) || 0,
    unitCost: Number(l.unitCost) || 0,
  })), [lines]);
  const total = purchaseInvoiceTotal(parsedLines);
  const paidNum = Number(paidNow) || 0;
  const due = Math.max(0, total - paidNum);
  const effectiveAccountId = accountId ?? accounts?.[0]?.id ?? null;

  function openForm() {
    setInvoiceUuid(newUuid());
    setVendorId(paramVendor);
    setLines([blankLine(1)]);
    setNotes("");
    setPaidNow("");
    setAccountId(null);
    setFormError("");
    setSavedNote("");
    setDetailId(null);
    setShowForm(true);
  }

  function setLine(key: number, patch: Partial<FormLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const save = useMutation({
    mutationFn: async () => {
      const input = { vendorId, lines: parsedLines, paidNow: paidNum, accountId: paidNum > 0 ? effectiveAccountId : null, notes };
      const err = validatePurchaseInvoice(input);
      if (err) throw new Error(err);
      // Reserve the ids up-front so the order, its lines and its payable
      // commit together (nextval is never rolled back, so a failed save
      // only leaves a gap — same as completeSale's order id).
      const oidRow = await dbGet<{ oid: number }>("SELECT nextval(pg_get_serial_sequence('purchase_orders', 'id')) AS oid");
      const oid = Number(oidRow?.oid ?? 0);
      if (!oid) throw new Error("Could not allocate an invoice id");
      const payRow = await dbGet<{ pid: number }>("SELECT nextval(pg_get_serial_sequence('vendor_payables', 'id')) AS pid");
      const payableId = Number(payRow?.pid ?? 0);
      if (!payableId) throw new Error("Could not allocate a payable id");
      // "Add new name" lines: reuse a product with the same name when one
      // already exists, otherwise create it with this receipt.
      const resolved: ResolvedPurchaseLine[] = [];
      const newProducts: NewPurchaseProduct[] = [];
      for (const l of parsedLines) {
        if (l.productId != null) {
          resolved.push({ productId: l.productId, qty: l.qty, unitCost: l.unitCost });
          continue;
        }
        const name = l.newName.trim();
        const found = await dbGet<{ id: number }>("SELECT id FROM products WHERE LOWER(name) = LOWER($1) LIMIT 1", [name]);
        if (found?.id) {
          resolved.push({ productId: found.id, qty: l.qty, unitCost: l.unitCost });
          continue;
        }
        const pr = await dbGet<{ pid: number }>("SELECT nextval(pg_get_serial_sequence('products', 'id')) AS pid");
        const nid = Number(pr?.pid ?? 0);
        if (!nid) throw new Error("Could not allocate a product id");
        newProducts.push({ id: nid, name, unitCost: l.unitCost });
        resolved.push({ productId: nid, qty: l.qty, unitCost: l.unitCost });
      }
      const statements = buildPurchaseInvoiceStatements({
        oid,
        payableId,
        vendorId: vendorId as number,
        invoiceUuid,
        lines: resolved,
        newProducts,
        total,
        paidNow: paidNum,
        accountId: paidNum > 0 ? effectiveAccountId : null,
        notes,
        occurredAt: purchaseToday(),
      });
      await dbTransaction(statements);
      return oid;
    },
    onSuccess: (oid) => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-log"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setShowForm(false);
      setSavedNote(`Invoice #${oid} saved — ${total.toLocaleString()} received into stock${paidNum > 0 ? `, ${paidNum.toLocaleString()} paid, ${due.toLocaleString()} due` : `, ${due.toLocaleString()} due`}.`);
      setDetailId(oid);
      // The ?vendor= preselect has served its purpose; clear it so the
      // next invoice starts clean.
      if (params.get("vendor")) setParams({}, { replace: true });
    },
    onError: (e: any) => {
      setFormError(e?.message || String(e));
      console.error(e);
    },
  });

  return (
    <Page title="Purchase Orders" action={<button className="btn btn-primary" onClick={openForm}>+ New Invoice</button>}>
      {savedNote && (
        <div className="card" style={{ padding: "10px 14px", marginBottom: 12, background: "#f0fdf4", borderColor: "#bbf7d0" }}>
          {savedNote}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className={`btn btn-sm ${tab === "invoices" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("invoices")}>Invoices</button>
        <button className={`btn btn-sm ${tab === "log" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("log")}>Stock-in log</button>
      </div>

      {showForm && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>New vendor invoice</div>
          <FormField label="Vendor *">
            <select className="input" value={vendorId ?? ""} onChange={(e) => setVendorId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Pick a vendor…</option>
              {vendors?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </FormField>

          <div style={{ fontWeight: 600, fontSize: "0.85rem", margin: "12px 0 6px" }}>Products received</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lines.map((l) => {
              const prod = products?.find((p: any) => p.id === l.productId);
              const lineTotal = purchaseLineTotal({ qty: Number(l.qty) || 0, unitCost: Number(l.unitCost) || 0 });
              return (
                <div key={l.key} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                    {l.newMode ? (
                      <input className="input" placeholder="New product name" value={l.newName}
                        onChange={(e) => setLine(l.key, { newName: e.target.value })} />
                    ) : (
                      <select className="input" value={l.productId ?? ""}
                        onChange={(e) => {
                          if (e.target.value === "__new__") { setLine(l.key, { newMode: true, productId: null }); return; }
                          const id = e.target.value ? Number(e.target.value) : null;
                          const p = products?.find((x: any) => x.id === id);
                          // Prefill the cost from the product's own cost
                          // price when the operator has not typed one.
                          setLine(l.key, { productId: id, unitCost: !l.unitCost && p ? String(p.cost_price ?? "") : l.unitCost });
                        }}>
                        <option value="">Pick a product…</option>
                        {products?.map((p: any) => <option key={p.id} value={p.id}>{p.name} — in stock {Number(p.stock_qty ?? 0).toLocaleString()}</option>)}
                        <option value="__new__">+ Add new product…</option>
                      </select>
                    )}
                    {l.newMode && (
                      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 4 }}
                        onClick={() => setLine(l.key, { newMode: false, newName: "" })}>← pick from stock instead</button>
                    )}
                  </div>
                  <div style={{ width: 90 }}>
                    <input className="input" type="number" min="0" step="any" placeholder="Qty" value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                  </div>
                  <div style={{ width: 120 }}>
                    <input className="input" type="number" min="0" step="any" placeholder="Cost / unit" value={l.unitCost}
                      onChange={(e) => setLine(l.key, { unitCost: e.target.value })} />
                  </div>
                  <div style={{ width: 90, fontSize: "0.85rem", fontWeight: 600, paddingBottom: 8 }}>
                    {lineTotal > 0 ? lineTotal.toLocaleString() : "—"}
                  </div>
                  {lines.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
            onClick={() => setLines((ls) => [...ls, blankLine(keyRef.current++)])}>+ Add product</button>

          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <FormField label="Paid now (optional)">
              <input className="input" type="number" min="0" step="any" placeholder="0" value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)} style={{ width: 140 }} />
            </FormField>
            {paidNum > 0 && (
              <FormField label="Paid from account">
                <select className="input" value={effectiveAccountId ?? ""} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
                  {accounts?.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </FormField>
            )}
            <FormField label="Notes (optional)">
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: 220 }} />
            </FormField>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: "0.95rem" }}>
              Total <b>{money(total)}</b>
              {paidNum > 0 && <> · Paid <b>{money(paidNum)}</b></>}
              <> · Due <b style={{ color: due > 0 ? "#b91c1c" : undefined }}>{money(due)}</b></>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save invoice & add to stock"}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
          {formError && <div style={{ color: "#b91c1c", marginTop: 8 }}>{formError}</div>}
        </div>
      )}

      {tab === "invoices" && detailId == null && (
        isLoading ? <div style={{ textAlign: "center", padding: 40 }}>Loading...</div> : !invoices?.length ? (
          <EmptyState title="No invoices yet" message="Receive your first shipment from a vendor" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {invoices.map((po: any) => (
              <div key={po.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                onClick={() => setDetailId(po.id)}>
                <div>
                  <div style={{ fontWeight: 600 }}>Invoice #{po.id} — {po.vendor_name ?? "Unknown vendor"}</div>
                  <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
                    {String(po.created_at ?? "").slice(0, 10)} · {po.line_count} item{Number(po.line_count) === 1 ? "" : "s"}
                    {po.notes ? ` · ${po.notes}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: "0.85rem" }}>
                  <div>Total <b>{money(Number(po.total))}</b></div>
                  <div>
                    Paid {money(Number(po.paid))}
                    {Number(po.total) - Number(po.paid) > 0 && (
                      <> · <span style={{ color: "#b91c1c", fontWeight: 700 }}>Due {money(Number(po.total) - Number(po.paid))}</span></>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "invoices" && detailId != null && detail && (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Invoice #{detail.head?.id} — {detail.head?.vendor_name ?? "Unknown vendor"}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setDetailId(null)}>← All invoices</button>
          </div>
          <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 4 }}>
            {String(detail.head?.created_at ?? "").slice(0, 10)} · Total <b>{money(Number(detail.head?.total))}</b>
            {" · "}Paid {money(Number(detail.head?.paid))}
            {" · "}Due <b style={{ color: Number(detail.head?.total) - Number(detail.head?.paid) > 0 ? "#b91c1c" : undefined }}>{money(Number(detail.head?.total) - Number(detail.head?.paid))}</b>
            {detail.head?.notes ? ` · ${detail.head.notes}` : ""}
          </div>

          <div style={{ fontWeight: 600, fontSize: "0.85rem", margin: "14px 0 6px" }}>Lines</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead><tr style={{ textAlign: "left", color: "#64748b" }}>
              <th style={{ padding: "4px 6px" }}>Product</th><th style={{ padding: "4px 6px" }}>Qty</th>
              <th style={{ padding: "4px 6px" }}>Cost / unit</th><th style={{ padding: "4px 6px" }}>Line total</th>
            </tr></thead>
            <tbody>
              {detail.items.map((it: any) => (
                <tr key={it.id}>
                  <td style={{ padding: "4px 6px" }}>{it.product_name}</td>
                  <td style={{ padding: "4px 6px" }}>{Number(it.qty).toLocaleString()}</td>
                  <td style={{ padding: "4px 6px" }}>{money(Number(it.cost_price))}</td>
                  <td style={{ padding: "4px 6px" }}>{money(Number(it.line_total))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontWeight: 600, fontSize: "0.85rem", margin: "14px 0 6px" }}>Added to stock by this invoice</div>
          {detail.moves.length === 0 ? (
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>No stock movements recorded for this invoice.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead><tr style={{ textAlign: "left", color: "#64748b" }}>
                <th style={{ padding: "4px 6px" }}>Product</th><th style={{ padding: "4px 6px" }}>Added</th>
                <th style={{ padding: "4px 6px" }}>Stock after</th><th style={{ padding: "4px 6px" }}>When</th>
              </tr></thead>
              <tbody>
                {detail.moves.map((m: any) => (
                  <tr key={m.id}>
                    <td style={{ padding: "4px 6px" }}>{m.product_name}</td>
                    <td style={{ padding: "4px 6px" }}>+{Number(m.qty).toLocaleString()}</td>
                    <td style={{ padding: "4px 6px" }}>{Number(m.qty_after ?? 0).toLocaleString()}</td>
                    <td style={{ padding: "4px 6px" }}>{String(m.occurred_at ?? "").slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "log" && (
        !logRows?.length ? (
          <EmptyState title="No stock received yet" message="Receive a vendor invoice and its products will be listed here" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {logRows.map((m: any) => (
              <div key={m.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{m.product_name} <span style={{ color: "#15803d" }}>+{Number(m.qty).toLocaleString()}</span></div>
                  <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
                    {String(m.occurred_at ?? "").slice(0, 10)} · from {m.vendor_name ?? "unknown vendor"} · Invoice #{m.ref_id} · stock after {Number(m.qty_after ?? 0).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </Page>
  );
}
