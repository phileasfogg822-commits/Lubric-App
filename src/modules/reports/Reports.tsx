import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "../../lib/db";
import { currency } from "../../lib/format";
import { Page } from "../../components/Page";
import { downloadCSV, printReport } from "../../lib/export";

// What the print view renders. Every tab publishes one of these via onPrint.
export interface PrintData {
  title: string; subtitle: string; meta: string[];
  headers: string[]; rows: (string | number)[][];
  totals?: [string, string][];
}

type Tab = "summary" | "statement" | "compare" | "export";

export default function Reports() {
  const [tab, setTab] = useState<Tab>("summary");
  const [printData, setPrintData] = useState<PrintData | null>(null);

  const { data: shop } = useQuery({
    queryKey: ["report_shop"],
    queryFn: () => dbSelect<any>("SELECT name, address, phone, currency FROM shops ORDER BY id LIMIT 1"),
  });

  function doPrint() {
    if (!printData) { alert("Generate a report first, then print."); return; }
    // Suggested PDF filename = report title + entity/period; printReport appends the timestamp.
    printReport(printData.title, printData.subtitle);
  }

  return (
    <Page
      title="Reports"
      action={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={doPrint}>Export PDF</button>
        </div>
      }
    >
      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "1px solid #e2e8f0" }}>
        {([["summary", "Summary"], ["statement", "Statements"], ["compare", "Comparison"], ["export", "Export Data"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 14px", fontSize: "0.85rem", border: "none", background: "none", cursor: "pointer",
            borderBottom: tab === t ? "2px solid var(--color-primary)" : "2px solid transparent",
            color: tab === t ? "var(--color-primary)" : "#64748b", fontWeight: tab === t ? 600 : 400,
          }}>{label}</button>
        ))}
      </div>

      {tab === "summary" && <SummaryTab shop={shop?.[0]} onPrint={setPrintData} />}
      {tab === "statement" && <StatementTab shop={shop?.[0]} onPrint={setPrintData} />}
      {tab === "compare" && <CompareTab shop={shop?.[0]} onPrint={setPrintData} />}
      {tab === "export" && <ExportTab />}

      {/* Print-only statement sheet — the only visible thing when printing.
          Portalled to <body> so the print CSS (visibility trick + absolute
          positioning) cannot be clipped by this page's scroll containers,
          which is what made "Prepare Print" → Export PDF come out blank. */}
      {printData && createPortal(
        <div className="report-print" style={{ padding: 24, background: "white" }}>
          <div style={{ borderBottom: "2px solid #0f172a", paddingBottom: 8, marginBottom: 12 }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{shop?.[0]?.name ?? "Lubric POS"}</div>
            <div style={{ fontSize: "0.78rem", color: "#475569" }}>
              {[shop?.[0]?.address, shop?.[0]?.phone].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <div style={{ fontSize: "1.05rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{printData.title}</div>
            <div style={{ fontSize: "0.85rem", color: "#334155" }}>{printData.subtitle}</div>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#475569", marginBottom: 10 }}>
            {printData.meta.map((m, i) => <div key={i}>{m}</div>)}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
            <thead>
              <tr>{printData.headers.map((h, i) => (
                <th key={i} style={{ borderBottom: "1.5px solid #0f172a", textAlign: i === 0 ? "left" : "right", padding: "5px 6px" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {printData.rows.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "white" }}>
                  {r.map((c, j) => (
                    <td key={j} style={{ padding: "4px 6px", textAlign: j === 0 ? "left" : "right", borderBottom: "1px solid #e2e8f0" }}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {printData.totals && (
            <div style={{ marginTop: 10, marginLeft: "auto", width: 260 }}>
              {printData.totals.map(([k, v], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 6px",
                  fontWeight: 700, borderTop: i === 0 ? "2px solid #0f172a" : "none", fontSize: "0.8rem" }}>
                  <span>{k}</span><span>{v}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 24, fontSize: "0.7rem", color: "#94a3b8", textAlign: "center" }}>
            Generated {new Date().toLocaleString()} · Lubric POS
          </div>
        </div>,
        document.body,
      )}
    </Page>
  );
}


// ── Shared bits ──────────────────────────────────────────────────────────────

const fmt = (n: unknown) => currency(Number(n) || 0);
const pctc = (a: number, b: number) => (b === 0 ? (a === 0 ? "—" : "new") : `${a > b ? "+" : ""}${Math.round(((a - b) / Math.abs(b)) * 100)}%`);

function DateInputs({ from, to, onFrom, onTo, extra }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; extra?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
      <input className="input" type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
      <input className="input" type="date" value={to} onChange={(e) => onTo(e.target.value)} />
      {extra}
    </div>
  );
}

function periodGrain(from: string, to: string): "day" | "week" | "month" {
  if (!from || !to) return "day";
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
  if (days > 400) return "month";
  if (days > 70) return "week";
  return "day";
}

// ── Summary tab ──────────────────────────────────────────────────────────────

function SummaryTab({ shop, onPrint }: { shop?: any; onPrint: (p: PrintData) => void }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [grain, setGrain] = useState<"auto" | "day" | "week" | "month">("auto");
  const [r, setR] = useState<{ rows: any[]; totals: any } | null>(null);
  const cur = shop?.currency ?? "PKR";

  async function run() {
    const g = grain === "auto" ? periodGrain(from, to) : grain;
    const p = [from, to];
    const [sales, exps] = await Promise.all([
      dbSelect<any>(`SELECT date_trunc('${g}', o.created_at)::date AS bucket, COUNT(*) AS bills,
                            COALESCE(SUM(o.total),0) AS incoming, COALESCE(SUM(o.paid_amount),0) AS paid
                     FROM orders o WHERE o.status='completed'
                     AND date(o.created_at) >= date($1) AND date(o.created_at) <= date($2)
                     GROUP BY 1 ORDER BY 1`, p),
      dbSelect<any>(`SELECT date_trunc('${g}', e.created_at)::date AS bucket, COALESCE(SUM(e.amount),0) AS outgoing
                     FROM expenses e WHERE date(e.created_at) >= date($1) AND date(e.created_at) <= date($2)
                     GROUP BY 1 ORDER BY 1`, p),
    ]);
    const expMap = new Map(exps.map((e: any) => [String(e.bucket), Number(e.outgoing)]));
    const rows: any[] = sales.map((s: any) => ({
      bucket: String(s.bucket), bills: Number(s.bills),
      incoming: Number(s.incoming), paid: Number(s.paid),
      outgoing: expMap.get(String(s.bucket)) ?? 0,
    }));
    for (const [k, v] of expMap) if (!rows.find((x) => x.bucket === k)) rows.push({ bucket: k, bills: 0, incoming: 0, paid: 0, outgoing: v });
    rows.sort((a, b) => a.bucket.localeCompare(b.bucket));
    const totals = rows.reduce((t: any, x: any) => ({
      bills: t.bills + x.bills, incoming: t.incoming + x.incoming,
      paid: t.paid + x.paid, outgoing: t.outgoing + x.outgoing,
    }), { bills: 0, incoming: 0, paid: 0, outgoing: 0 });
    setR({ rows, totals });
  }

  function publish() {
    if (!r) return;
    const t = r.totals;
    onPrint({
      title: "Sales Summary",
      subtitle: `${from} to ${to}`,
      meta: [`${shop?.name ?? ""} · Currency: ${cur}`],
      headers: ["Period", "Bills", "Incoming", "Collected", "Remaining", "Outgoing", "Profit"],
      rows: r.rows.map((x) => [x.bucket, x.bills, fmt(x.incoming), fmt(x.paid), fmt(x.incoming - x.paid), fmt(x.outgoing), fmt(x.incoming - x.outgoing)]),
      totals: [
        ["Bills", String(t.bills)], ["Incoming", fmt(t.incoming)], ["Collected", fmt(t.paid)],
        ["Remaining (credit)", fmt(t.incoming - t.paid)], ["Outgoing", fmt(t.outgoing)],
        ["Profit", fmt(t.incoming - t.outgoing)],
      ],
    });
  }


  const t = r?.totals;
  return (
    <div>
      <DateInputs from={from} to={to} onFrom={setFrom} onTo={setTo} extra={<>
        <select className="input" value={grain} onChange={(e) => setGrain(e.target.value as any)} style={{ width: 110 }}>
          <option value="auto">Auto</option><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option>
        </select>
        <button className="btn btn-primary" onClick={run}>Generate</button>
        {r && <><button className="btn btn-ghost" onClick={publish}>Prepare Print</button>
        <button className="btn btn-ghost" onClick={() => downloadCSV(`summary-${from}-${to}.csv`,
          ["Period", "Bills", "Incoming", "Collected", "Remaining", "Outgoing", "Profit"],
          r.rows.map((x) => [x.bucket, x.bills, x.incoming, x.paid, x.incoming - x.paid, x.outgoing, x.incoming - x.outgoing]))}>CSV</button></>}
      </>} />
      {!r ? <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Pick a range and Generate</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
            {([["Bills", String(t!.bills), "#0f172a"], ["Incoming", fmt(t!.incoming), "var(--color-primary)"],
               ["Collected", fmt(t!.paid), "#16a34a"], ["Remaining", fmt(t!.incoming - t!.paid), "#dc2626"],
               ["Outgoing", fmt(t!.outgoing), "#dc2626"], ["Profit", fmt(t!.incoming - t!.outgoing), "#0f172a"]] as [string, string, string][]).map(([k, v, c]) => (
              <div key={k} className="card"><div style={{ fontSize: "0.72rem", color: "#64748b", textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, color: c }}>{v}</div></div>
            ))}
          </div>
          <table className="table" style={{ fontSize: "0.82rem" }}>
            <thead><tr><th>Period</th><th>Bills</th><th>Incoming</th><th>Collected</th><th>Remaining</th><th>Outgoing</th><th>Profit</th></tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.bucket}>
                  <td>{x.bucket}</td><td>{x.bills}</td><td>{fmt(x.incoming)}</td><td style={{ color: "#16a34a" }}>{fmt(x.paid)}</td>
                  <td style={{ color: x.incoming - x.paid > 0.004 ? "#dc2626" : "#94a3b8" }}>{fmt(x.incoming - x.paid)}</td>
                  <td style={{ color: "#dc2626" }}>{fmt(x.outgoing)}</td>
                  <td style={{ fontWeight: 600 }}>{fmt(x.incoming - x.outgoing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}


// ── Statement tab ────────────────────────────────────────────────────────────

function StatementTab({ shop, onPrint }: { shop?: any; onPrint: (p: PrintData) => void }) {
  const [kind, setKind] = useState<"customer" | "vendor">("customer");
  const [entityId, setEntityId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [r, setR] = useState<{ rows: any[]; opening: number; closing: number } | null>(null);
  const [entityName, setEntityName] = useState("");
  const cur = shop?.currency ?? "PKR";

  const { data: customers } = useQuery({
    queryKey: ["stmt_customers"], enabled: kind === "customer",
    queryFn: () => dbSelect<any>("SELECT id, name FROM customers ORDER BY name"),
  });
  const { data: vendors } = useQuery({
    queryKey: ["stmt_vendors"], enabled: kind === "vendor",
    queryFn: () => dbSelect<any>("SELECT id, name FROM vendors ORDER BY name"),
  });

  async function run() {
    if (!entityId) return;
    const ent = (kind === "customer" ? customers : vendors)?.find((e: any) => e.id === entityId);
    setEntityName(ent?.name ?? `#${entityId}`);
    let rows: any[] = [];
    let opening = 0;
    if (kind === "customer") {
      const openP: unknown[] = [entityId];
      let ow = "o.status='completed' AND o.customer_id=$1";
      if (from) { openP.push(from); ow += ` AND date(o.created_at) < date($${openP.length})`; }
      opening = Number((await dbSelect<any>(`SELECT COALESCE(SUM(total - paid_amount),0) AS bal FROM orders o WHERE ${ow}`, openP))[0]?.bal ?? 0);
      const p: unknown[] = [entityId];
      let w = "o.status='completed' AND o.customer_id=$1";
      if (from) { p.push(from); w += ` AND date(o.created_at) >= date($${p.length})`; }
      if (to) { p.push(to); w += ` AND date(o.created_at) <= date($${p.length})`; }
      const orders = await dbSelect<any>(
        `SELECT o.id, o.created_at, o.total, o.paid_amount, o.notes FROM orders o WHERE ${w} ORDER BY o.created_at, o.id`, p);
      let bal = opening;
      rows = orders.map((o: any) => {
        bal += Number(o.total) - Number(o.paid_amount);
        return { date: String(o.created_at).slice(0, 10), ref: `Invoice #${o.id}`, desc: o.notes || "",
                 debit: Number(o.total), credit: Number(o.paid_amount), balance: bal };
      });
    } else {
      const openP: unknown[] = [entityId];
      let ow = `COALESCE((SELECT SUM(total) FROM purchase_orders po WHERE po.vendor_id=$1 AND po.status='received'`;
      if (from) { openP.push(from); ow += ` AND date(po.created_at) < date($${openP.length})`; }
      ow += `),0) - COALESCE((SELECT SUM(amount) FROM vendor_payables vp WHERE vp.vendor_id=$1 AND vp.status IN ('paid','partial')`;
      if (from) ow += ` AND date(vp.created_at) < date($${openP.length})`;
      ow += `),0)`;
      opening = Number((await dbSelect<any>(`SELECT ${ow} AS bal`, openP))[0]?.bal ?? 0);
      const p: unknown[] = [entityId];
      let wpo = "po.status='received' AND po.vendor_id=$1";
      let wvp = "vp.status IN ('paid','partial') AND vp.vendor_id=$1";
      if (from) { p.push(from); wpo += ` AND date(po.created_at) >= date($${p.length})`; wvp += ` AND date(vp.created_at) >= date($${p.length})`; }
      if (to) { p.push(to); wpo += ` AND date(po.created_at) <= date($${p.length})`; wvp += ` AND date(vp.created_at) <= date($${p.length})`; }
      const [pos, pays] = await Promise.all([
        dbSelect<any>(`SELECT po.id, po.created_at, po.total FROM purchase_orders po WHERE ${wpo} ORDER BY po.created_at, po.id`, p),
        dbSelect<any>(`SELECT vp.id, vp.created_at, vp.amount FROM vendor_payables vp WHERE ${wvp} ORDER BY vp.created_at, vp.id`, p),
      ]);
      const merged: any[] = [
        ...pos.map((o: any) => ({ date: String(o.created_at).slice(0, 10), ref: `Purchase #${o.id}`, desc: "", debit: Number(o.total), credit: 0 })),
        ...pays.map((v: any) => ({ date: String(v.created_at).slice(0, 10), ref: `Payment #${v.id}`, desc: "", debit: 0, credit: Number(v.amount) })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      let bal = opening;
      rows = merged.map((m) => { bal += m.debit - m.credit; return { ...m, balance: bal }; });
    }
    const closing = rows.length ? rows[rows.length - 1].balance : opening;
    setR({ rows, opening, closing });
  }


  function publish() {
    if (!r) return;
    onPrint({
      title: kind === "customer" ? "Statement of Account" : "Vendor Ledger",
      subtitle: entityName,
      meta: [`Period: ${from || "beginning"} to ${to || "today"}`, `Currency: ${cur}`, `Opening balance: ${fmt(r.opening)}`],
      headers: ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
      rows: r.rows.map((x) => [x.date, x.ref, x.desc, x.debit ? fmt(x.debit) : "—", x.credit ? fmt(x.credit) : "—", fmt(x.balance)]),
      totals: [["Closing balance", fmt(r.closing)]],
    });
  }

  const remTotal = r ? r.rows.reduce((s, x) => s + (x.debit - x.credit), 0) : 0;
  return (
    <div>
      <DateInputs from={from} to={to} onFrom={setFrom} onTo={setTo} extra={<>
        <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as any); setEntityId(null); setR(null); }} style={{ width: 110 }}>
          <option value="customer">Customer</option><option value="vendor">Vendor</option>
        </select>
        <select className="input" value={entityId ?? ""} onChange={(e) => setEntityId(e.target.value ? Number(e.target.value) : null)} style={{ width: 180 }}>
          <option value="">Select {kind}...</option>
          {(kind === "customer" ? customers : vendors)?.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={run} disabled={!entityId}>Generate</button>
        {r && <><button className="btn btn-ghost" onClick={publish}>Prepare Print</button>
        <button className="btn btn-ghost" onClick={() => downloadCSV(`statement-${entityName}-${from || "all"}-${to || "all"}.csv`,
          ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
          r.rows.map((x) => [x.date, x.ref, x.desc, x.debit, x.credit, x.balance]))}>CSV</button></>}
      </>} />
      {!r ? <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Pick a {kind} and Generate</div> : (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div className="card" style={{ flex: 1 }}><div style={{ fontSize: "0.72rem", color: "#64748b" }}>Opening balance</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{fmt(r.opening)}</div></div>
            <div className="card" style={{ flex: 1 }}><div style={{ fontSize: "0.72rem", color: "#64748b" }}>Period movement</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: remTotal > 0 ? "#dc2626" : "#16a34a" }}>{fmt(remTotal)}</div></div>
            <div className="card" style={{ flex: 1 }}><div style={{ fontSize: "0.72rem", color: "#64748b" }}>Closing balance</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{fmt(r.closing)}</div></div>
          </div>
          <table className="table" style={{ fontSize: "0.82rem" }}>
            <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th style={{ textAlign: "right" }}>Debit</th>
              <th style={{ textAlign: "right" }}>Credit</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
            <tbody>
              <tr style={{ background: "#f8fafc" }}><td colSpan={5} style={{ fontStyle: "italic", color: "#64748b" }}>Opening balance</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(r.opening)}</td></tr>
              {r.rows.map((x, i) => (
                <tr key={i}>
                  <td>{x.date}</td><td>{x.ref}</td><td style={{ color: "#64748b" }}>{x.desc}</td>
                  <td style={{ textAlign: "right" }}>{x.debit ? fmt(x.debit) : "—"}</td>
                  <td style={{ textAlign: "right", color: "#16a34a" }}>{x.credit ? fmt(x.credit) : "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(x.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}


// ── Comparison tab ───────────────────────────────────────────────────────────

function CompareTab({ shop, onPrint }: { shop?: any; onPrint: (p: PrintData) => void }) {
  const [scope, setScope] = useState<"shop" | "customer" | "vendor">("shop");
  const [entityId, setEntityId] = useState<number | null>(null);
  const [aFrom, setAFrom] = useState("");
  const [aTo, setATo] = useState("");
  const [bFrom, setBFrom] = useState("");
  const [bTo, setBTo] = useState("");
  const [r, setR] = useState<{ a: any; b: any; labelA: string; labelB: string } | null>(null);
  const [entityName, setEntityName] = useState("");

  const { data: customers } = useQuery({
    queryKey: ["cmp_customers"], enabled: scope === "customer",
    queryFn: () => dbSelect<any>("SELECT id, name FROM customers ORDER BY name"),
  });
  const { data: vendors } = useQuery({
    queryKey: ["cmp_vendors"], enabled: scope === "vendor",
    queryFn: () => dbSelect<any>("SELECT id, name FROM vendors ORDER BY name"),
  });

  async function metrics(f: string, t: string): Promise<any> {
    const zero = { bills: 0, incoming: 0, paid: 0, outgoing: 0, profit: 0 };
    if (scope === "vendor" && entityId) {
      const p: unknown[] = [entityId];
      let w = "po.status='received' AND po.vendor_id=$1";
      if (f) { p.push(f); w += ` AND date(po.created_at) >= date($${p.length})`; }
      if (t) { p.push(t); w += ` AND date(po.created_at) <= date($${p.length})`; }
      const po = await dbSelect<any>(`SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS incoming FROM purchase_orders po WHERE ${w}`, p);
      const pp: unknown[] = [entityId];
      let pw = "vendor_id=$1 AND status IN ('paid','partial')";
      if (f) { pp.push(f); pw += ` AND date(created_at) >= date($${pp.length})`; }
      if (t) { pp.push(t); pw += ` AND date(created_at) <= date($${pp.length})`; }
      const pay = await dbSelect<any>(`SELECT COALESCE(SUM(amount),0) AS paid FROM vendor_payables WHERE ${pw}`, pp);
      const incoming = Number(po[0]?.incoming ?? 0), paid = Number(pay[0]?.paid ?? 0);
      return { ...zero, bills: Number(po[0]?.bills ?? 0), incoming, paid, outgoing: incoming, profit: incoming - paid };
    }
    const p: unknown[] = [];
    let w = "o.status='completed'";
    let wc = "1=1";
    if (scope === "customer" && entityId) { p.push(entityId); w += ` AND o.customer_id=$${p.length}`; }
    if (f) { p.push(f); w += ` AND date(o.created_at) >= date($${p.length})`; wc += ` AND date(created_at) >= date($${p.length})`; }
    if (t) { p.push(t); w += ` AND date(o.created_at) <= date($${p.length})`; wc += ` AND date(created_at) <= date($${p.length})`; }
    const [o, e] = await Promise.all([
      dbSelect<any>(`SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS incoming, COALESCE(SUM(paid_amount),0) AS paid FROM orders o WHERE ${w}`, p),
      dbSelect<any>(`SELECT COALESCE(SUM(amount),0) AS outgoing FROM expenses WHERE ${wc}`, p),
    ]);
    const incoming = Number(o[0]?.incoming ?? 0), outgoing = Number(e[0]?.outgoing ?? 0);
    return { bills: Number(o[0]?.bills ?? 0), incoming, paid: Number(o[0]?.paid ?? 0), outgoing, profit: incoming - outgoing };
  }

  async function run() {
    if (scope !== "shop" && !entityId) return;
    setEntityName(scope === "customer" ? (customers?.find((c: any) => c.id === entityId)?.name ?? "")
      : scope === "vendor" ? (vendors?.find((v: any) => v.id === entityId)?.name ?? "") : "Whole shop");
    const [a, b] = await Promise.all([metrics(aFrom, aTo), metrics(bFrom, bTo)]);
    setR({ a, b, labelA: `${aFrom || "beginning"} → ${aTo || "today"}`, labelB: `${bFrom || "beginning"} → ${bTo || "today"}` });
  }


  function publish() {
    if (!r) return;
    const val = (x: any, k: string) => (k === "remaining" ? x.incoming - x.paid : x[k]);
    const rows: (string | number)[][] = ["bills", "incoming", "paid", "remaining", "outgoing", "profit"].map((k) => {
      const a = val(r.a, k), b = val(r.b, k), d = a - b;
      return [k[0].toUpperCase() + k.slice(1), fmt(a), fmt(b), (d > 0 ? "+" : "") + fmt(d), pctc(a, b)];
    });
    onPrint({
      title: "Comparative Report", subtitle: entityName,
      meta: [`Period A: ${r.labelA}`, `Period B: ${r.labelB}`, `Currency: ${shop?.currency ?? "PKR"}`],
      headers: ["Metric", "Period A", "Period B", "Change", "Change %"], rows,
    });
  }

  function exportCsv() {
    if (!r) return;
    const val = (x: any, k: string) => (k === "remaining" ? x.incoming - x.paid : x[k]);
    downloadCSV(`comparison-${entityName.replace(/\s+/g, "_")}.csv`, ["Metric", "Period A", "Period B", "Change", "Change %"],
      ["bills", "incoming", "paid", "remaining", "outgoing", "profit"].map((k) => {
        const a = val(r.a, k), b = val(r.b, k);
        return [k, a, b, a - b, pctc(a, b)];
      }));
  }

  const ROW = (label: string, a: number, b: number) => {
    const d = a - b;
    return (
      <tr key={label}>
        <td style={{ fontWeight: 500 }}>{label}</td><td>{fmt(a)}</td><td>{fmt(b)}</td>
        <td style={{ color: d > 0 ? "#16a34a" : d < 0 ? "#dc2626" : "#64748b", fontWeight: 600 }}>{d > 0 ? "+" : ""}{fmt(d)}</td>
        <td style={{ color: d > 0 ? "#16a34a" : d < 0 ? "#dc2626" : "#64748b" }}>{pctc(a, b)}</td>
      </tr>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <b style={{ fontSize: "0.8rem" }}>Period A</b>
        <input className="input" type="date" value={aFrom} onChange={(e) => setAFrom(e.target.value)} />
        <input className="input" type="date" value={aTo} onChange={(e) => setATo(e.target.value)} />
        <b style={{ fontSize: "0.8rem", marginLeft: 8 }}>vs Period B</b>
        <input className="input" type="date" value={bFrom} onChange={(e) => setBFrom(e.target.value)} />
        <input className="input" type="date" value={bTo} onChange={(e) => setBTo(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select className="input" value={scope} onChange={(e) => { setScope(e.target.value as any); setEntityId(null); setR(null); }} style={{ width: 130 }}>
          <option value="shop">Whole shop</option><option value="customer">Customer</option><option value="vendor">Vendor</option>
        </select>
        {scope !== "shop" && (
          <select className="input" value={entityId ?? ""} onChange={(e) => setEntityId(e.target.value ? Number(e.target.value) : null)} style={{ width: 180 }}>
            <option value="">Select {scope}...</option>
            {(scope === "customer" ? customers : vendors)?.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        <button className="btn btn-primary" onClick={run} disabled={scope !== "shop" && !entityId}>Compare</button>
        {r && <><button className="btn btn-ghost" onClick={publish}>Prepare Print</button>
        <button className="btn btn-ghost" onClick={exportCsv}>CSV</button></>}
      </div>
      {!r ? <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Pick two periods and Compare</div> : (
        <>
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginBottom: 8 }}>
            <b>{entityName}</b> — A: {r.labelA} · B: {r.labelB}
          </div>
          <table className="table" style={{ fontSize: "0.85rem" }}>
            <thead><tr><th>Metric</th><th>Period A</th><th>Period B</th><th>Change</th><th>Change %</th></tr></thead>
            <tbody>
              {ROW("Bills", r.a.bills, r.b.bills)}
              {ROW("Incoming", r.a.incoming, r.b.incoming)}
              {ROW("Collected", r.a.paid, r.b.paid)}
              {ROW("Remaining (credit)", r.a.incoming - r.a.paid, r.b.incoming - r.b.paid)}
              {ROW("Outgoing", r.a.outgoing, r.b.outgoing)}
              {ROW("Profit", r.a.profit, r.b.profit)}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}


// ── Export tab ───────────────────────────────────────────────────────────────

function ExportTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  async function exportCustomers() {
    const rows = await dbSelect<any>(
      `SELECT c.*, COUNT(o.id) AS visits, COALESCE(SUM(o.total),0) AS lifetime,
              MAX(o.created_at) AS last_visit
       FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status='completed'
       GROUP BY c.id ORDER BY c.name`);
    downloadCSV("customers.csv",
      ["ID", "Name", "Phone", "Type", "Credit balance", "Visits", "Lifetime spend", "Last visit"],
      rows.map((c: any) => [c.id, c.name, c.phone, c.customer_type, c.credit_balance, c.visits, c.lifetime, String(c.last_visit ?? "").slice(0, 10)]));
  }

  async function exportSales() {
    const p: unknown[] = [];
    let w = "o.status <> 'draft'";
    if (from) { p.push(from); w += ` AND date(o.created_at) >= date($${p.length})`; }
    if (to) { p.push(to); w += ` AND date(o.created_at) <= date($${p.length})`; }
    const rows = await dbSelect<any>(
      `SELECT o.id, o.created_at, c.name AS customer, v.registration, v.make, v.model, oi.kind, oi.product_name AS item,
              oi.qty, oi.unit_price, oi.line_total, oi.capacity, oi.leftover_litres, oi.leftover_to, o.total, o.paid_amount, o.status
       FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN vehicles v ON v.id=o.vehicle_id
       LEFT JOIN order_items oi ON oi.order_id=o.id WHERE ${w} ORDER BY o.created_at, o.id, oi.id`, p);
    downloadCSV(`sales-lines-${from || "all"}-${to || "all"}.csv`,
      ["Order", "Date", "Customer", "Registration", "Vehicle", "Kind", "Item", "Qty", "Unit price", "Line total", "Capacity L", "Leftover L", "Leftover to", "Order total", "Paid", "Status"],
      rows.map((r: any) => [r.id, String(r.created_at).slice(0, 16).replace("T", " "), r.customer ?? "Walk-in", r.registration ?? "",
        [r.make, r.model].filter(Boolean).join(" "), r.kind, r.item, r.qty, r.unit_price, r.line_total,
        r.capacity, r.leftover_litres, r.leftover_to, r.total, r.paid_amount, r.status]));
  }

  async function exportExpenses() {
    const p: unknown[] = [];
    let w = "1=1";
    if (from) { p.push(from); w += ` AND date(created_at) >= date($${p.length})`; }
    if (to) { p.push(to); w += ` AND date(created_at) <= date($${p.length})`; }
    const rows = await dbSelect<any>(`SELECT * FROM expenses WHERE ${w} ORDER BY created_at`, p);
    downloadCSV(`expenses-${from || "all"}-${to || "all"}.csv`,
      ["ID", "Date", "Category", "Amount", "Note"],
      rows.map((e: any) => [e.id, String(e.created_at).slice(0, 10), e.category, e.amount, e.note]));
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <b style={{ fontSize: "0.8rem" }}>Date range (optional)</b>
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Customer data</div>
          <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 10 }}>All customers with visit counts, lifetime spend, credit balance and last visit.</div>
          <button className="btn btn-primary" onClick={exportCustomers}>Export customers CSV</button>
        </div>
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Sales (line level)</div>
          <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 10 }}>Every bill line in the range: item, qty, price, capacity, leftover routing, paid and status.</div>
          <button className="btn btn-primary" onClick={exportSales}>Export sales CSV</button>
        </div>
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Expenses</div>
          <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 10 }}>All expenses in the range with category and note.</div>
          <button className="btn btn-primary" onClick={exportExpenses}>Export expenses CSV</button>
        </div>
      </div>
    </div>
  );
}
