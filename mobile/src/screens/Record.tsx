import { useState } from "react";
import { recordMovement } from "../store";

type Kind = "collection" | "handover";

export default function Record({ onSaved }: { onSaved: () => void }) {
  const [kind, setKind] = useState<Kind>("collection");
  const [amount, setAmount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [err, setErr] = useState("");

  async function save() {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter an amount"); return; }
    try {
      await recordMovement(kind, amt, customerName.trim(), note.trim());
      setSaved(`${kind === "collection" ? "Collection" : "Handover"} of PKR ${amt.toLocaleString()} saved.`);
      setAmount(""); setNote(""); setErr("");
      setTimeout(() => { setSaved(""); onSaved(); }, 900);
    } catch (e: any) {
      setErr(e.message || "Could not save");
    }
  }

  return (
    <div className="pad">
      <div className="seg">
        <button className={kind === "collection" ? "segbtn active" : "segbtn"} onClick={() => setKind("collection")}>💰 Collection</button>
        <button className={kind === "handover" ? "segbtn active" : "segbtn"} onClick={() => setKind("handover")}>🤝 Cash handover</button>
      </div>

      <label className="lbl">Amount (PKR)</label>
      <input className="inp big" type="numeric" inputMode="numeric" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />

      <label className="lbl">{kind === "collection" ? "From (customer)" : "Handed to"}</label>
      <input className="inp" placeholder={kind === "collection" ? "Customer name" : "Owner / shop"} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />

      <label className="lbl">Note</label>
      <input className="inp" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />

      {err && <div className="err">{err}</div>}
      {saved && <div className="ok">{saved}</div>}

      <button className="primary" onClick={save} disabled={!amount}>Save {kind === "collection" ? "collection" : "handover"}</button>
      <p className="hint">Saved on the phone first — syncs to the shop automatically.</p>
    </div>
  );
}
