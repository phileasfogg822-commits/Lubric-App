import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { dbSelect, dbExecute } from "../../lib/db";
import { Page } from "../../components/Page";
import { Modal } from "../../components/Modal";
import { FormField } from "../../components/FormField";
import { EmptyState } from "../../components/EmptyState";
import { ReminderModal, ReminderDraft } from "../../components/ReminderModal";

export default function Vendors() {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<number|null>(null);
  const [form, setForm] = useState({ name: "", contact: "", phone: "" });
  const [meetingFor, setMeetingFor] = useState<ReminderDraft | null>(null);
  const [showMeeting, setShowMeeting] = useState(false);

  function scheduleMeeting(v: any) {
    setMeetingFor({
      kind: "vendor_meeting",
      title: `Meeting with ${v.name}`,
      details: v.contact ? `Contact: ${v.contact}${v.phone ? " · " + v.phone : ""}` : "",
      vendor_id: v.id,
      priority: "normal",
    });
    setShowMeeting(true);
  }
  const { data: vendors, isLoading } = useQuery({ queryKey: ["vendors"], queryFn: () => dbSelect<any>("SELECT * FROM vendors ORDER BY name") });
  function openAdd() { setEditId(null); setForm({ name: "", contact: "", phone: "" }); setShow(true); }
  function openEdit(v: any) { setEditId(v.id); setForm({ name: v.name, contact: v.contact ?? "", phone: v.phone ?? "" }); setShow(true); }
  const save = useMutation({
    mutationFn: async () => {
      if (editId) await dbExecute("UPDATE vendors SET name=$1, contact=$2, phone=$3 WHERE id=$4", [form.name, form.contact, form.phone, editId]);
      else await dbExecute("INSERT INTO vendors (name, contact, phone, payable_balance) VALUES ($1, $2, $3, 0)", [form.name, form.contact, form.phone]);
    },
    onSuccess: () => { qc.invalidateQueries(); setShow(false); },
    onError: (e: any) => { alert("Error saving vendor: " + (e?.message || e)); console.error(e); },
  });
  return (
    <Page title="Vendors" action={<button className="btn btn-primary" onClick={openAdd}>+ Add Vendor</button>}>
      {isLoading ? <div style={{ textAlign: "center", padding: 40 }}>Loading...</div> : !vendors?.length ? <EmptyState title="No vendors" message="Add your first vendor" /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {vendors.map((v: any) => (
            <div key={v.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{v.name}</span>
                  {Number(v.payable_balance) > 0 && (
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#b91c1c" }}>
                      owes {Number(v.payable_balance).toLocaleString()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.8rem", color: "#64748b" }}>{v.contact} {v.phone ? `· ${v.phone}` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Link className="btn btn-ghost btn-sm" to={`/ledger?type=vendor&id=${v.id}`}>Khata</Link>
                <button className="btn btn-ghost btn-sm" onClick={() => scheduleMeeting(v)}>🗓 Meet</button>
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(v)}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {show && (
        <Modal title={editId ? "Edit Vendor" : "Add Vendor"} onClose={() => setShow(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <FormField label="Company Name *"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormField>
            <FormField label="Contact Person"><input className="input" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} /></FormField>
            <FormField label="Phone"><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></FormField>
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              <button className="btn btn-primary" onClick={() => save.mutate()} disabled={!form.name}>{editId ? "Save Changes" : "Add Vendor"}</button>
              <button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      <ReminderModal open={showMeeting} onClose={() => { setShowMeeting(false); setMeetingFor(null); }} initial={meetingFor} />
    </Page>
  );
}
