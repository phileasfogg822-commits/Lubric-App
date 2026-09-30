import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { dbSelect, dbExecute } from "../../lib/db";
import { Page } from "../../components/Page";
import { Modal } from "../../components/Modal";
import { FormField } from "../../components/FormField";
import { EmptyState } from "../../components/EmptyState";
import { downloadCSV } from "../../lib/export";
import { ReminderModal, ReminderDraft } from "../../components/ReminderModal";

export default function Customers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<number|null>(null);
  const [form, setForm] = useState({ name: "", phone: "", customer_type: "returning" });
  const [followUpFor, setFollowUpFor] = useState<ReminderDraft | null>(null);
  const [showFollowUp, setShowFollowUp] = useState(false);

  function openFollowUp(c: any) {
    const owes = Number(c.credit_balance || 0) > 0;
    setFollowUpFor({
      kind: owes ? "credit_followup" : "todo",
      title: owes
        ? `Collect payment from ${c.name} (${Number(c.credit_balance).toLocaleString()})`
        : `Follow up with ${c.name}`,
      details: c.phone ? `Phone: ${c.phone}` : "",
      customer_id: c.id,
      priority: owes ? "high" : "normal",
    });
    setShowFollowUp(true);
  }
  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers_admin", search],
    queryFn: () => {
      let sql = "SELECT * FROM customers";
      const p: any[] = [];
      if (search) { p.push(`%${search}%`); sql += " WHERE name LIKE $" + p.length + " OR phone LIKE $" + p.length; }
      return dbSelect<any>(sql + " ORDER BY name", p);
    },
  });
  function openAdd() { setEditId(null); setForm({ name: "", phone: "", customer_type: "returning" }); setShow(true); }
  function openEdit(c: any) { setEditId(c.id); setForm({ name: c.name, phone: c.phone ?? "", customer_type: c.customer_type ?? "returning" }); setShow(true); }
  const save = useMutation({
    mutationFn: async () => {
      if (editId) await dbExecute("UPDATE customers SET name=$1, phone=$2, customer_type=$3 WHERE id=$4", [form.name, form.phone, form.customer_type, editId]);
      else await dbExecute("INSERT INTO customers (name, phone, customer_type, credit_balance) VALUES ($1, $2, $3, 0)", [form.name, form.phone, form.customer_type]);
    },
    onSuccess: () => { qc.invalidateQueries(); setShow(false); },
    onError: (e: any) => { alert("Error saving customer: " + (e?.message || e)); console.error(e); },
  });
  return (
    <Page title="Customers" action={
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-ghost" onClick={async () => {
          const all = await dbSelect<any>(
            `SELECT c.*, COUNT(o.id) AS visits, COALESCE(SUM(o.total),0) AS lifetime
             FROM customers c LEFT JOIN orders o ON o.customer_id=c.id AND o.status='completed'
             GROUP BY c.id ORDER BY c.name`);
          downloadCSV("customers.csv",
            ["ID", "Name", "Phone", "Type", "Credit balance", "Visits", "Lifetime spend"],
            all.map((c: any) => [c.id, c.name, c.phone, c.customer_type, c.credit_balance, c.visits, c.lifetime]));
        }}>Export CSV</button>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Customer</button>
      </div>
    }>
      <div style={{ marginBottom: 12 }}><input className="input" placeholder="Search by name or phone..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      {isLoading ? <div style={{ textAlign: "center", padding: 40 }}>Loading...</div> : !customers?.length ? <EmptyState title="No customers" message="Add your first customer" /> : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>Name</th><th>Phone</th><th>Type</th><th style={{ textAlign: "right" }}>Balance</th><th></th><th></th></tr></thead>
            <tbody>
              {customers.map((c: any) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td>{c.phone || "—"}</td>
                  <td><span style={{ fontSize: "0.75rem", padding: "1px 6px", borderRadius: 4, background: c.customer_type === "wholesale" ? "#fef3c7" : "#e0f2fe", color: c.customer_type === "wholesale" ? "#92400e" : "#0369a1" }}>{c.customer_type}</span></td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: Number(c.credit_balance) > 0 ? "#b91c1c" : "#64748b" }}>
                    {Number(c.credit_balance) > 0 ? Number(c.credit_balance).toLocaleString() : "—"}
                  </td>
                  <td><Link className="btn btn-ghost btn-sm" to={`/ledger?id=${c.id}`}>Khata</Link></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => openFollowUp(c)}>🔔 Follow-up</button></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {show && (
        <Modal title={editId ? "Edit Customer" : "Add Customer"} onClose={() => setShow(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <FormField label="Name *"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormField>
            <FormField label="Phone"><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></FormField>
            <FormField label="Customer Type">
              <select className="input" value={form.customer_type} onChange={e => setForm({ ...form, customer_type: e.target.value })}>
                <option value="walking">Walking</option><option value="returning">Returning</option><option value="wholesale">Wholesale</option>
              </select>
            </FormField>
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              <button className="btn btn-primary" onClick={() => save.mutate()} disabled={!form.name}>{editId ? "Save Changes" : "Add Customer"}</button>
              <button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      <ReminderModal open={showFollowUp} onClose={() => { setShowFollowUp(false); setFollowUpFor(null); }} initial={followUpFor} />
    </Page>
  );
}
