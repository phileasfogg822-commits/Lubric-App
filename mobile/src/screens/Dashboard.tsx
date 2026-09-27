import { useEffect, useState } from "react";
import { todayTotals, outstandingCustomers, type CashMovement, type CustomerRow } from "../store";

const money = (n: number) => `PKR ${n.toLocaleString()}`;

export default function Dashboard() {
  const [totals, setTotals] = useState<{ collections: number; handovers: number; movements: CashMovement[] }>({ collections: 0, handovers: 0, movements: [] });
  const [customers, setCustomers] = useState<CustomerRow[]>([]);

  async function refresh() {
    setTotals(await todayTotals());
    setCustomers(await outstandingCustomers());
  }
  useEffect(() => { refresh(); }, []);

  const cashInHand = totals.collections - totals.handovers;

  return (
    <div className="pad">
      <div className="cards">
        <div className="card green">
          <div className="lbl2">Collected today</div>
          <div className="big">{money(totals.collections)}</div>
        </div>
        <div className="card red">
          <div className="lbl2">Handed over</div>
          <div className="big">{money(totals.handovers)}</div>
        </div>
      </div>
      <div className="card blue">
        <div className="lbl2">Cash in hand</div>
        <div className="big">{money(cashInHand)}</div>
      </div>

      <h2 className="h2">Today's movements</h2>
      {totals.movements.length === 0 && <div className="empty">Nothing recorded yet today.</div>}
      {totals.movements.map((m) => (
        <div key={m.uuid} className="row">
          <div>
            <div className="rowtitle">{m.kind === "collection" ? "Collection" : m.kind === "handover" ? "Cash handover" : "Adjustment"}
              {m.customer_name ? ` · ${m.customer_name}` : ""}</div>
            {m.note && <div className="sub">{m.note}</div>}
          </div>
          <div className={m.kind === "collection" ? "amt green2" : "amt red2"}>
            {m.kind === "collection" ? "+" : "−"}{money(Number(m.amount))}
            {!m.synced && <span className="pend"> · pending</span>}
          </div>
        </div>
      ))}

      <h2 className="h2">Outstanding balances</h2>
      {customers.length === 0 && <div className="empty">No balances loaded yet — run Sync.</div>}
      {customers.map((c) => (
        <div key={c.uuid} className="row">
          <div>
            <div className="rowtitle">{c.name}</div>
            <div className="sub">{c.phone || c.customer_type}</div>
          </div>
          <div className="amt red2">{money(Number(c.credit_balance))}</div>
        </div>
      ))}
    </div>
  );
}
