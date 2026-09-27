import { useEffect, useState } from "react";
import { openReservations, recordReservation, type ReservationRow } from "../store";

export default function Reservations() {
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [items, setItems] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  async function refresh() { setRows(await openReservations()); }
  useEffect(() => { refresh(); }, []);

  async function save() {
    const amt = Number(amount) || 0;
    if (!customerName.trim() || !items.trim()) { setMsg("Customer and items are required"); return; }
    await recordReservation(customerName.trim(), items.trim(), amt, note.trim());
    setMsg("Reservation saved — syncs to the shop.");
    setCustomerName(""); setItems(""); setAmount(""); setNote("");
    await refresh();
    setTimeout(() => setMsg(""), 1200);
  }

  return (
    <div className="pad">
      <h2 className="h2">New reservation</h2>
      <label className="lbl">Customer</label>
      <input className="inp" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      <label className="lbl">Items</label>
      <input className="inp" placeholder="e.g. 2× ZIC 20W-50, 1× oil filter" value={items} onChange={(e) => setItems(e.target.value)} />
      <label className="lbl">Amount (PKR)</label>
      <input className="inp" type="numeric" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
      <label className="lbl">Note</label>
      <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
      {msg && <div className="ok">{msg}</div>}
      <button className="primary" onClick={save} disabled={!customerName || !items}>Reserve</button>

      <h2 className="h2">Open reservations</h2>
      {rows.length === 0 && <div className="empty">None yet.</div>}
      {rows.map((r) => (
        <div key={r.uuid} className="row">
          <div>
            <div className="rowtitle">{r.customer_name}</div>
            <div className="sub">{r.items_json}</div>
          </div>
          <div className="amt">{Number(r.amount) ? `PKR ${Number(r.amount).toLocaleString()}` : ""}{!r.synced && <span className="pend"> · pending</span>}</div>
        </div>
      ))}
    </div>
  );
}
