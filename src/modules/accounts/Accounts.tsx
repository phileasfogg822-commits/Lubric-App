import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbExecute } from "../../lib/db";
import { currency } from "../../lib/format";
import { Page } from "../../components/Page";
import { Modal } from "../../components/Modal";
import { FormField } from "../../components/FormField";
import { EmptyState } from "../../components/EmptyState";

export default function Accounts() {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<number|null>(null);
  const [form, setForm] = useState({ name: "", type: "cash" });
  const [showTx, setShowTx] = useState<any>(null);
  const { data: accounts } = useQuery({ queryKey: ["accounts_admin"], queryFn: () => dbSelect<any>("SELECT * FROM accounts ORDER BY name") });
  const { data: transactions } = useQuery({ queryKey: ["acc_tx", showTx?.id], queryFn: () => dbSelect<any>("SELECT * FROM account_transactions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 50", [showTx?.id]), enabled: !!showTx });
  function openAdd() { setEditId(null); setForm({ name: "", type: "cash" }); setShow(true); }
  function openEdit(a: any) { setEditId(a.id); setForm({ name: a.name, type: a.type }); setShow(true); }
  const save = useMutation({
    mutationFn: async () => {
      if (editId) await dbExecute("UPDATE accounts SET name=$1, type=$2 WHERE id=$3", [form.name, form.type, editId]);
      else await dbExecute("INSERT INTO accounts (name, type, balance, active) VALUES ($1, $2, 0, 1)", [form.name, form.type]);
    },
    onSuccess: () => { qc.invalidateQueries(); setShow(false); },
  });
  const toggle = useMutation({ mutationFn: async ({ id, a }: any) => { await dbExecute("UPDATE accounts SET active=$1 WHERE id=$2", [a ? 1 : 0, id]); }, onSuccess: () => qc.invalidateQueries() });
  return (
    <Page title="Accounts" action={<button className="btn btn-primary" onClick={openAdd}>+ Add Account</button>}>
      {!accounts?.length ? <EmptyState title="No accounts" message="Add a cash/bank account" /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {accounts.map((a: any) => (
            <div key={a.id} className="card" style={{ opacity: a.active ? 1 : 0.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase" }}>{a.type}</div>
                  <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>{a.name}</div>
                </div>
                <button className="toggle" onClick={() => toggle.mutate({ id: a.id, a: !a.active })}><span className={`toggle-knob ${a.active ? "on" : ""}`} /></button>
              </div>
              <div style={{ marginTop: 12, fontSize: "1.5rem", fontWeight: 800, color: "var(--color-primary)" }}>{currency(a.balance)}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowTx(a)}>History</button>
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(a)}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {show && (
        <Modal title={editId ? "Edit Account" : "Add Account"} onClose={() => setShow(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <FormField label="Account Name *"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormField>
            <FormField label="Type">
              <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                <option value="cash">Cash</option><option value="bank">Bank</option><option value="credit_card">Credit Card</option><option value="other">Other</option>
              </select>
            </FormField>
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              <button className="btn btn-primary" onClick={() => save.mutate()} disabled={!form.name}>{editId ? "Save Changes" : "Add Account"}</button>
              <button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {showTx && (
        <Modal title={`${showTx.name} - History`} onClose={() => setShowTx(null)} wide>
          <div style={{ marginBottom: 12 }}><div style={{ fontSize: "0.8rem", color: "#64748b" }}>Current Balance</div><div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{currency(showTx.balance)}</div></div>
          {!transactions?.length ? <EmptyState title="No transactions" message="No transactions yet" /> : (
            <div style={{ maxHeight: 400, overflow: "auto" }}>
              {transactions.map((t: any) => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <div>
                    <div style={{ fontSize: "0.85rem" }}>{t.reference}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{t.created_at?.replace("T", " ").split(".")[0]}</div>
                  </div>
                  <div style={{ fontWeight: 600, color: t.type === "in" ? "#16a34a" : "#dc2626" }}>{t.type === "in" ? "+" : "-"}{currency(t.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Page>
  );
}
