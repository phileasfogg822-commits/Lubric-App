import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "../../lib/db";
import { currency, d } from "../../lib/format";
import { Page } from "../../components/Page";
import { EmptyState } from "../../components/EmptyState";
import { downloadCSV } from "../../lib/export";

/**
 * What the field phones have actually sent.
 *
 * This page exists because `cash_movements` and `reservations` were the only
 * tables in the system that NOTHING displayed. The field app uploaded
 * correctly - collections were sitting in Postgres the whole time - but the
 * shop had no way to see them, which from the counter is indistinguishable
 * from the sync being broken. Money a collector is physically holding has to
 * be visible, so it lives here rather than buried in a report.
 *
 * Queries use the same `::date` / `now() - interval` idioms as the Dashboard so
 * they survive the Postgres-to-SQLite translation used in offline mode.
 */

interface Movement {
  id: number;
  uuid: string;
  kind: string;
  amount: number;
  customer_name: string | null;
  note: string | null;
  occurred_at: string;
  origin: string | null;
  taken_by_name: string | null;
  device_name: string | null;
}

interface Reservation {
  id: number;
  uuid: string;
  customer_name: string | null;
  items_json: string | null;
  amount: number;
  status: string;
  note: string | null;
  created_at: string;
}

interface Totals {
  collected: number;
  handed_over: number;
  adjusted: number;
  rows: number;
}

const RANGES = [
  { key: "today", label: "Today", where: "m.occurred_at::date = CURRENT_DATE" },
  { key: "7", label: "Last 7 days", where: "m.occurred_at >= now() - interval '7 days'" },
  { key: "30", label: "Last 30 days", where: "m.occurred_at >= now() - interval '30 days'" },
  { key: "all", label: "All time", where: "1=1" },
] as const;

const KIND_LABEL: Record<string, string> = {
  collection: "Collected",
  handover: "Handed over",
  adjustment: "Adjustment",
};

export default function FieldActivity() {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("7");
  const active = RANGES.find((r) => r.key === range)!;

  const movements = useQuery({
    queryKey: ["field_movements", range],
    queryFn: () =>
      dbSelect<Movement>(`SELECT m.id, m.uuid, m.kind, m.amount, m.customer_name,
              m.note, m.occurred_at, m.origin, m.taken_by_name,
              dv.name AS device_name
         FROM cash_movements m
         LEFT JOIN devices dv ON dv.id = m.taken_by_device_id
        WHERE ${active.where}
        ORDER BY m.occurred_at DESC
        LIMIT 500`),
  });

  const totals = useQuery({
    queryKey: ["field_totals", range],
    queryFn: () =>
      dbSelect<Totals>(`SELECT
              COALESCE(SUM(CASE WHEN m.kind = 'collection' THEN m.amount ELSE 0 END), 0) AS collected,
              COALESCE(SUM(CASE WHEN m.kind = 'handover'   THEN m.amount ELSE 0 END), 0) AS handed_over,
              COALESCE(SUM(CASE WHEN m.kind = 'adjustment' THEN m.amount ELSE 0 END), 0) AS adjusted,
              COUNT(*) AS rows
         FROM cash_movements m
        WHERE ${active.where}`),
  });

  const reservations = useQuery({
    queryKey: ["field_reservations", range],
    queryFn: () =>
      dbSelect<Reservation>(`SELECT r.id, r.uuid, r.customer_name, r.items_json,
              r.amount, r.status, r.note, r.created_at
         FROM reservations r
        WHERE ${active.where.replace("m.", "r.").replace("occurred_at", "created_at")}
        ORDER BY r.created_at DESC
        LIMIT 300`),
  });

  const rows = movements.data ?? [];
  const t = totals.data?.[0];
  const inHand = (t?.collected ?? 0) - (t?.handed_over ?? 0);

  const phones = useMemo(() => {
    const names = new Set<string>();
    for (const m of rows) if (m.device_name) names.add(m.device_name);
    return [...names].sort();
  }, [rows]);

  function exportCsv() {
    downloadCSV(
      `field-collections-${range}.csv`,
      ["When", "Kind", "Amount", "Customer", "Collector", "Phone", "Note"],
      rows.map((m) => [
        m.occurred_at,
        KIND_LABEL[m.kind] ?? m.kind,
        String(m.amount),
        m.customer_name ?? "",
        m.taken_by_name || (m.device_name ?? ""),
        m.device_name ?? "",
        m.note ?? "",
      ]),
    );
  }

  return (
    <Page
      title="Field Activity"
      subtitle="Collections, handovers and reservations taken on the shop's phones"
      action={
        <button className="btn btn-ghost" onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </button>
      }
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={`btn btn-sm ${r.key === range ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Stat label="Collected" value={t?.collected ?? 0} tone="#16a34a" />
        <Stat label="Handed over" value={t?.handed_over ?? 0} tone="#f59e0b" />
        <Stat label="Still in hand" value={inHand} tone="#0f172a" strong />
        <Stat label="Records" value={t?.rows ?? 0} plain />
      </div>

      <h3 style={{ fontSize: "0.95rem", margin: "0 0 10px" }}>
        Collections &amp; handovers
        {phones.length > 0 && (
          <span style={{ fontWeight: 400, color: "#64748b", fontSize: "0.8rem" }}>
            {" "}— from {phones.join(", ")}
          </span>
        )}
      </h3>

      {!movements.isLoading && !rows.length ? (
        <EmptyState
          title="Nothing from the field yet"
          message="Collections taken on a paired phone appear here as soon as that phone syncs."
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Customer</th>
                <th>Collector</th>
                <th>Phone</th>
                <th>Note</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.uuid}>
                  <td style={{ whiteSpace: "nowrap" }}>{d(m.occurred_at)}</td>
                  <td>
                    <span
                      className={`badge ${
                        m.kind === "collection"
                          ? "badge-green"
                          : m.kind === "handover"
                            ? "badge-yellow"
                            : "badge-gray"
                      }`}
                    >
                      {KIND_LABEL[m.kind] ?? m.kind}
                    </span>
                  </td>
                  <td>{m.customer_name || <span style={{ color: "#94a3b8" }}>—</span>}</td>
                  <td style={{ fontSize: "0.8rem", color: "#64748b" }}>
                    {m.taken_by_name ? (
                      <span style={{ fontWeight: 600, color: "#475569" }}>
                        {m.taken_by_name}
                      </span>
                    ) : (
                      <span style={{ color: "#b45309" }}>collector not recorded</span>
                    )}
                    {m.device_name && (
                      <span style={{ color: "#94a3b8" }}> · {m.device_name}</span>
                    )}
                  </td>
                  <td style={{ fontSize: "0.8rem", color: "#64748b" }}>{m.note || ""}</td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 600,
                      color: m.kind === "handover" ? "#b45309" : "#166534",
                    }}
                  >
                    {m.kind === "handover" ? "−" : ""}
                    {currency(m.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ fontSize: "0.95rem", margin: "28px 0 10px" }}>Reservations</h3>
      {reservations.data?.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {reservations.data.map((r) => (
                <tr key={r.uuid}>
                  <td style={{ whiteSpace: "nowrap" }}>{d(r.created_at)}</td>
                  <td>{r.customer_name || "—"}</td>
                  <td style={{ fontSize: "0.8rem", color: "#64748b", maxWidth: 320 }}>
                    {r.items_json || "—"}
                  </td>
                  <td>
                    <span className={`badge ${r.status === "open" ? "badge-blue" : "badge-gray"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{currency(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: 16, fontSize: "0.85rem", color: "#64748b" }}>
          No reservations taken in the field for this period.
        </div>
      )}
    </Page>
  );
}

function Stat({
  label,
  value,
  tone,
  plain,
  strong,
}: {
  label: string;
  value: number;
  tone?: string;
  plain?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className="card"
      style={{ padding: 14, borderLeft: `3px solid ${plain ? "#e2e8f0" : tone || "#e2e8f0"}` }}
    >
      <div
        style={{
          fontSize: "0.72rem",
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: strong ? "1.5rem" : "1.25rem", fontWeight: 700, marginTop: 4 }}>
        {plain ? value : currency(value)}
      </div>
    </div>
  );
}