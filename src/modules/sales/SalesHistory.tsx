import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dbSelect } from "../../lib/db";
import { currency } from "../../lib/format";
import { Page } from "../../components/Page";
import { EmptyState } from "../../components/EmptyState";
import { downloadCSV, printReport } from "../../lib/export";
import { voidOrder, deleteVoidedOrder } from "./editSale";
import EditButton from "./EditButton";
import { useAuth } from "../../lib/auth";
import { PERMISSIONS } from "../../lib/permissions";

type Kind = "all" | "sale" | "purchase" | "expense";
type Party = "all" | "walking" | "returning" | "wholesale" | "vendor";

interface Txn {
  key: string;
  kind: "sale" | "purchase" | "expense";
  id: number;
  at: string;
  day: string;
  party: string;
  partyType: string;
  vehicle: string;
  items: number;
  amount: number;
  paid: number;
  status: string;
}

const KIND_STYLE: Record<Txn["kind"], { bg: string; fg: string; label: string }> = {
  sale: { bg: "#dcfce7", fg: "#166534", label: "Sale" },
  purchase: { bg: "#dbeafe", fg: "#1e40af", label: "Purchase" },
  expense: { bg: "#fee2e2", fg: "#991b1b", label: "Expense" },
};

const PARTY_OPTIONS: { value: Party; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "walking", label: "Walk-in customers" },
  { value: "returning", label: "Returning / retail" },
  { value: "wholesale", label: "Wholesale" },
  { value: "vendor", label: "Vendors" },
];

/** "2026-09-21 14:07" from whatever timestamp Postgres hands back. */
function stamp(v: unknown) {
  const s = String(v ?? "");
  return s ? s.replace("T", " ").split(".")[0].slice(0, 16) : "";
}

function dayOf(v: unknown) {
  return stamp(v).slice(0, 10);
}

export default function SalesHistory() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();

  const canEdit = hasPermission(PERMISSIONS.BILL_EDIT);
  const canVoid = hasPermission(PERMISSIONS.BILL_VOID);
  const canDelete = hasPermission(PERMISSIONS.BILL_DELETE);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [party, setParty] = useState<Party>("all");

  const { data: sales, isLoading } = useQuery({
    queryKey: ["txn-sales", from, to],
    queryFn: () => {
      const p: unknown[] = [];
      let w = "WHERE o.status <> 'draft'";
      if (from) { p.push(from); w += ` AND date(o.created_at) >= date($${p.length})`; }
      if (to) { p.push(to); w += ` AND date(o.created_at) <= date($${p.length})`; }
      return dbSelect<any>(
        `SELECT o.id, o.total, o.paid_amount, o.status, o.created_at, o.notes,
                c.name AS customer_name, c.customer_type,
                v.registration, v.make, v.model,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
         LEFT JOIN vehicles v ON v.id = o.vehicle_id
         ${w}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT 500`,
        p
      );
    },
  });

  // Purchases and expenses are gated server-side, so a cashier without those
  // permissions gets a 403 here — we degrade to hiding those rows instead of
  // breaking the page.
  const { data: purchases, isError: noPurchaseAccess } = useQuery({
    queryKey: ["txn-purchases", from, to],
    retry: false,
    queryFn: () => {
      const p: unknown[] = [];
      let w = "WHERE po.status <> 'draft'";
      if (from) { p.push(from); w += ` AND date(po.created_at) >= date($${p.length})`; }
      if (to) { p.push(to); w += ` AND date(po.created_at) <= date($${p.length})`; }
      return dbSelect<any>(
        `SELECT po.id, po.total, po.status, po.created_at, vd.name AS vendor_name
         FROM purchase_orders po
         LEFT JOIN vendors vd ON vd.id = po.vendor_id
         ${w}
         ORDER BY po.created_at DESC, po.id DESC
         LIMIT 500`,
        p
      );
    },
  });

  const { data: expenseRows, isError: noExpenseAccess } = useQuery({
    queryKey: ["txn-expenses", from, to],
    retry: false,
    queryFn: () => {
      const DAY = "COALESCE(NULLIF(e.date, ''), to_char(e.created_at, 'YYYY-MM-DD'))";
      const p: unknown[] = [];
      let w = "WHERE 1=1";
      if (from) { p.push(from); w += ` AND ${DAY} >= $${p.length}`; }
      if (to) { p.push(to); w += ` AND ${DAY} <= $${p.length}`; }
      return dbSelect<any>(
        `SELECT e.id, e.amount, e.category, e.subcategory, e.created_at, e.date
         FROM expenses e
         ${w}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT 500`,
        p
      );
    },
  });

  /** One flat ledger: sales money in, purchases and expenses money out. */
  const all = useMemo<Txn[]>(() => {
    const rows: Txn[] = [];

    for (const o of sales ?? []) {
      rows.push({
        key: `sale-${o.id}`,
        kind: "sale",
        id: o.id,
        at: stamp(o.created_at),
        day: dayOf(o.created_at),
        party: o.customer_name ?? "Walk-in",
        partyType: o.customer_type ?? "walking",
        vehicle: o.registration
          ? `${o.registration}${o.make ? " · " + [o.make, o.model].filter(Boolean).join(" ") : ""}`
          : "",
        items: Number(o.item_count ?? 0),
        amount: Number(o.total ?? 0),
        paid: Number(o.paid_amount ?? 0),
        status: o.status ?? "",
      });
    }

    for (const po of purchases ?? []) {
      rows.push({
        key: `purchase-${po.id}`,
        kind: "purchase",
        id: po.id,
        at: stamp(po.created_at),
        day: dayOf(po.created_at),
        party: po.vendor_name ?? "Vendor",
        partyType: "vendor",
        vehicle: "",
        items: 0,
        amount: Number(po.total ?? 0),
        paid: Number(po.total ?? 0),
        status: po.status ?? "",
      });
    }

    for (const e of expenseRows ?? []) {
      const d = e.date || dayOf(e.created_at);
      rows.push({
        key: `expense-${e.id}`,
        kind: "expense",
        id: e.id,
        at: `${d} ${stamp(e.created_at).slice(11)}`.trim(),
        day: d,
        party: e.subcategory ? `${e.category} / ${e.subcategory}` : e.category,
        partyType: "expense",
        vehicle: "",
        items: 0,
        amount: Number(e.amount ?? 0),
        paid: Number(e.amount ?? 0),
        status: "recorded",
      });
    }

    return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [sales, purchases, expenseRows]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (party !== "all" && r.partyType !== party) return false;
      if (q) {
        const hay = `${r.party} ${r.vehicle} ${r.partyType} ${r.kind} ${r.id} ${r.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, kind, party, search]);

  const totals = useMemo(() => {
    let billed = 0;
    let collected = 0;
    let out = 0;
    for (const r of rows) {
      if (r.kind === "sale") {
        billed += r.amount;
        collected += r.paid;
      } else {
        out += r.amount;
      }
    }
    return { count: rows.length, billed, collected, due: billed - collected, out };
  }, [rows]);

  const period = `${from || "the beginning"} to ${to || "today"}`;

  const EXPORT_HEADERS = [
    "Date", "Type", "Ref", "Party", "Party type", "Vehicle",
    "Items", "Amount", "Paid", "Remaining", "Status",
  ];

  function exportRows() {
    return rows.map((r) => [
      r.day,
      KIND_STYLE[r.kind].label,
      r.id,
      r.party,
      r.partyType,
      r.vehicle,
      r.items || "",
      r.amount,
      r.paid,
      r.kind === "sale" ? r.amount - r.paid : "",
      r.status,
    ]);
  }

  function exportCsv() {
    downloadCSV(`transactions-${from || "all"}-${to || "all"}.csv`, EXPORT_HEADERS, exportRows());
  }

  const scopeLabel =
    (kind === "all" ? "All transactions" : `${KIND_STYLE[kind as Txn["kind"]].label}s`) +
    (party === "all" ? "" : ` · ${PARTY_OPTIONS.find((o) => o.value === party)?.label}`);

  return (
    <Page
      title="Transaction History"
      subtitle="Sales, vendor purchases and expenses in one searchable ledger"
      action={
        <div style={{ display: "flex", gap: 8 }}>
          {/* PDF first — it renders the sheet below and opens the print dialog. */}
          <button className="btn btn-primary" onClick={() => printReport("Transaction Report", period, scopeLabel)} disabled={!rows.length}>
            Export PDF
          </button>
          <button className="btn btn-ghost" onClick={exportCsv} disabled={!rows.length}>
            Export CSV
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          placeholder="Search name, plate, vendor, ref..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 250 }}
        />
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To" />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)} style={{ width: 150 }}>
          <option value="all">All types</option>
          <option value="sale">Sales</option>
          <option value="purchase">Purchases</option>
          <option value="expense">Expenses</option>
        </select>
        <select className="input" value={party} onChange={(e) => setParty(e.target.value as Party)} style={{ width: 175 }}>
          {PARTY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {(search || from || to || kind !== "all" || party !== "all") && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setSearch(""); setFrom(""); setTo(""); setKind("all"); setParty("all"); }}
          >
            Clear
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
        <SummaryCard label="Transactions" value={String(totals.count)} />
        <SummaryCard label="Billed (sales)" value={currency(totals.billed)} />
        <SummaryCard label="Collected" value={currency(totals.collected)} tone="#16a34a" />
        <SummaryCard label="Outstanding" value={currency(totals.due)} tone={totals.due > 0.004 ? "#dc2626" : "#94a3b8"} />
        <SummaryCard label="Paid out (vendor + expenses)" value={currency(totals.out)} tone="#1e40af" />
      </div>

      {noPurchaseAccess && (
        <div style={{ fontSize: "0.8rem", color: "#92400e", background: "#fef3c7", padding: "8px 12px", borderRadius: 6, marginBottom: 8 }}>
          Purchase history is hidden — this account does not have the Purchases permission.
        </div>
      )}
      {noExpenseAccess && (
        <div style={{ fontSize: "0.8rem", color: "#92400e", background: "#fef3c7", padding: "8px 12px", borderRadius: 6, marginBottom: 8 }}>
          Expenses are hidden — this account does not have the Expenses permission.
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40 }}>Loading...</div>
      ) : !rows.length ? (
        <EmptyState title="No transactions" message="Adjust the filters or record a sale" />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Ref</th>
                <th>Party</th>
                <th>Vehicle</th>
                <th style={{ textAlign: "right" }}>Items</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th style={{ textAlign: "right" }}>Paid</th>
                <th style={{ textAlign: "right" }}>Remaining</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ks = KIND_STYLE[r.kind];
                const rem = r.kind === "sale" ? r.amount - r.paid : 0;
                const cancelled = r.status === "cancelled";
                return (
                  <tr key={r.key} style={cancelled ? { opacity: 0.5 } : undefined}>
                    <td style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>{r.at}</td>
                    <td>
                      <span style={{ fontSize: "0.72rem", padding: "1px 7px", borderRadius: 4, background: ks.bg, color: ks.fg, fontWeight: 600 }}>
                        {ks.label}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{r.id}</td>
                    <td>
                      {r.party}
                      {r.partyType && r.partyType !== "vendor" && r.partyType !== "expense" && (
                        <span style={{ marginLeft: 6, fontSize: "0.68rem", color: "#94a3b8", textTransform: "capitalize" }}>
                          {r.partyType}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "#64748b" }}>{r.vehicle || "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.items || "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, color: r.kind === "sale" ? "#0f172a" : "#dc2626" }}>
                      {currency(r.amount)}
                    </td>
                    <td style={{ textAlign: "right", color: "#16a34a" }}>
                      {r.kind === "sale" ? currency(r.paid) : "—"}
                    </td>
                    <td style={{ textAlign: "right", color: rem > 0.004 ? "#dc2626" : "#94a3b8" }}>
                      {r.kind === "sale" ? currency(rem) : "—"}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: cancelled ? "#fee2e2" : r.kind === "sale" ? "#dcfce7" : "#f1f5f9",
                          color: cancelled ? "#991b1b" : r.kind === "sale" ? "#166534" : "#475569",
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {r.kind === "sale" && !cancelled && canEdit && (
                        <EditButton orderId={r.id} onDone={() => qc.invalidateQueries()} />
                      )}
                      {r.kind === "sale" && !cancelled && canVoid && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: "#dc2626" }}
                          onClick={async () => {
                            if (confirm(`Void order #${r.id}? Stock and the ledger are reversed.`)) {
                              try {
                                await voidOrder(r.id);
                                qc.invalidateQueries();
                              } catch (e: any) {
                                alert(e.message);
                              }
                            }
                          }}
                        >
                          Void
                        </button>
                      )}
                      {r.kind === "sale" && cancelled && canDelete && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: "#dc2626" }}
                          onClick={async () => {
                            if (confirm(`Permanently delete order #${r.id}?`)) {
                              try {
                                await deleteVoidedOrder(r.id);
                                qc.invalidateQueries();
                              } catch (e: any) {
                                alert(e.message);
                              }
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* A4 sheet — invisible on screen; it is the only thing printReport() prints.
          Portalled to <body> so the print CSS cannot be clipped by the page's
          scroll containers (same blank-PDF bug as the Reports page). */}
      {createPortal(
        <div className="report-print" style={{ padding: 24, background: "white" }}>
        <div style={{ borderBottom: "2px solid #0f172a", paddingBottom: 8, marginBottom: 12 }}>
          <div style={{ fontSize: "1.35rem", fontWeight: 800, letterSpacing: "0.04em" }}>LUBRIC POS</div>
          <div style={{ fontSize: "0.8rem", color: "#475569" }}>Zafar Lubricants</div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div style={{ fontSize: "1rem", fontWeight: 700 }}>Transaction Report</div>
          <div style={{ fontSize: "0.8rem", color: "#475569" }}>{period}</div>
        </div>

        <div style={{ fontSize: "0.82rem", color: "#334155", marginBottom: 12 }}>
          <div><b>Scope:</b> {scopeLabel}</div>
          {search && <div><b>Search:</b> {search}</div>}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              {EXPORT_HEADERS.map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "5px 6px",
                    borderBottom: "1px solid #334155",
                    background: "#f1f5f9",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exportRows().map((cells, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                {cells.map((c, j) => (
                  <td key={j} style={{ padding: "4px 6px" }}>{String(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 14, paddingTop: 8, borderTop: "2px solid #0f172a", fontSize: "0.85rem" }}>
          <PrintRow label="Transactions" value={String(totals.count)} />
          <PrintRow label="Billed (sales)" value={currency(totals.billed)} />
          <PrintRow label="Collected" value={currency(totals.collected)} />
          <PrintRow label="Outstanding" value={currency(totals.due)} />
          <PrintRow label="Paid out (vendors + expenses)" value={currency(totals.out)} />
          <PrintRow label="Net (collected − paid out)" value={currency(totals.collected - totals.out)} bold />
        </div>

        <div style={{ marginTop: 18, fontSize: "0.72rem", color: "#64748b" }}>
          Generated {new Date().toLocaleString()}
        </div>
      </div>,
        document.body,
      )}
    </Page>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: "10px 12px" }}>
      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: "1.05rem", fontWeight: 700, color: tone ?? "#0f172a" }}>{value}</div>
    </div>
  );
}

function PrintRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontWeight: bold ? 800 : 400 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}



