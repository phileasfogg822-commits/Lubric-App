import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dbSelect } from "../../lib/db";
import { currency, d } from "../../lib/format";
import { downloadCSV, printReport } from "../../lib/export";
import { Page } from "../../components/Page";
import { EmptyState } from "../../components/EmptyState";
import {
  fetchMonthly,
  fetchStatement,
  listParties,
  recordBill,
  recordPayment,
  type PartyType,
} from "../../lib/ledger";
import { PostEntryModal, type EntryInput, type EntryKind } from "./PostEntryModal";
import {
  PERIODS,
  kindLabel,
  monthKey,
  monthLabel,
  pctChange,
  periodFor,
  periodLabel,
  statementText,
  type PeriodKey,
} from "./statement";

/**
 * Khata — the ledger per person (server/migrations/014_party_ledger.sql).
 *
 * This page answers the three questions a field user actually asks, which the
 * old denormalised balance column could not:
 *   * "show me everything with this customer between March and June"
 *   * "is he buying more or less than last month?"
 *   * "print me his statement and WhatsApp it to him"
 *
 * Every figure on screen is derived from ledger rows — there is no stored
 * balance to drift out of step with the history behind it.
 */
export default function Ledger() {
  const qc = useQueryClient();
  // The party lives in the URL so the Customers and Vendors screens can deep
  // link straight into someone's statement (?type=vendor&id=3).
  const [params, setParams] = useSearchParams();
  const partyType: PartyType = params.get("type") === "vendor" ? "vendor" : "customer";
  const customer = partyType === "customer";

  const [search, setSearch] = useState("");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("all");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [entry, setEntry] = useState<EntryKind | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const period = useMemo(
    () => periodFor(periodKey, { from: custom.from, to: custom.to }),
    [periodKey, custom.from, custom.to]
  );

  const { data: parties = [], isLoading: loadingParties } = useQuery({
    queryKey: ["ledger_parties", partyType],
    queryFn: () => listParties(partyType),
  });

  // No id in the URL yet: open on whoever owes (or is owed) the most, so the
  // page lands on something that needs attention.
  const urlId = Number(params.get("id")) || null;
  const party =
    parties.find((p) => p.party_id === urlId) ??
    parties.find((p) => Math.abs(p.balance) > 0.005) ??
    parties[0] ??
    null;

  const { data: view, isLoading: loadingStatement } = useQuery({
    queryKey: ["ledger_statement", partyType, party?.party_id, periodKey, custom.from, custom.to],
    queryFn: () => fetchStatement(partyType, party!.party_id, period),
    enabled: !!party,
  });

  const { data: monthly = [] } = useQuery({
    queryKey: ["ledger_monthly", partyType, party?.party_id],
    queryFn: () => fetchMonthly(partyType, party!.party_id, 6),
    enabled: !!party,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts_pick"],
    queryFn: () => dbSelect<any>("SELECT id, name FROM accounts WHERE active = 1 ORDER BY name"),
  });

  const { data: shop } = useQuery({
    queryKey: ["ledger_shop"],
    queryFn: () => dbSelect<any>("SELECT name, address, phone FROM shops ORDER BY id LIMIT 1"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? parties.filter(
          (p) => p.name.toLowerCase().includes(q) || String(p.phone ?? "").includes(q)
        )
      : parties;
    // Outstanding first, then by size — the people who need chasing float up.
    return [...list].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [parties, search]);

  const byMonth = useMemo(() => {
    const map = new Map<string, { billed: number; settled: number }>();
    for (const m of monthly) map.set(monthKey(m.month), { billed: m.billed, settled: m.settled });
    const now = new Date();
    const zero = { billed: 0, settled: 0 };
    return {
      thisMonth: map.get(monthKey(now)) ?? zero,
      lastMonth: map.get(monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))) ?? zero,
    };
  }, [monthly]);

  const invalidate = () => {
    for (const key of ["ledger_parties", "ledger_statement", "ledger_monthly"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
    // The denormalised balance column and the account balance both moved with
    // the posting, so the screens that still read them are stale too.
    qc.invalidateQueries({ queryKey: ["customers_admin"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["vendors"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };

  const post = useMutation({
    mutationFn: async (input: EntryInput) => {
      if (!party) throw new Error("No party selected");
      if (entry === "payment") {
        await recordPayment({
          partyType,
          partyId: party.party_id,
          partyName: party.name,
          amount: input.amount,
          accountId: input.accountId,
          note: input.note,
          occurredAt: input.occurredAt,
        });
      } else {
        await recordBill({
          partyType,
          partyId: party.party_id,
          partyName: party.name,
          amount: input.amount,
          note: input.note,
          occurredAt: input.occurredAt,
          dueDate: input.dueDate,
        });
      }
    },
    onSuccess: () => {
      setEntry(null);
      setError("");
      invalidate();
    },
    onError: (e: any) => setError(e?.message || String(e)),
  });

  function selectParty(id: number) {
    setParams({ type: partyType, id: String(id) }, { replace: true });
    setCopied(false);
  }

  function switchType(next: PartyType) {
    setParams(next === "customer" ? {} : { type: next }, { replace: true });
    setError("");
  }

  function exportCSV() {
    if (!party || !view) return;
    const rows: (string | number)[][] = [];
    if (period.from) rows.push(["Balance b/d", "", "", "", "", view.opening]);
    for (const r of view.rows) {
      rows.push([
        d(r.occurred_at),
        kindLabel(r, customer),
        r.note,
        r.direction === "debit" ? r.amount : "",
        r.direction === "credit" ? r.amount : "",
        r.running,
      ]);
    }
    rows.push(["", "Total", "", view.totalDebit, view.totalCredit, view.balance]);
    downloadCSV(
      `${customer ? "customer" : "vendor"} ${party.name} statement.csv`,
      ["Date", "Particulars", "Notes", "Debit", "Credit", "Balance"],
      rows
    );
  }

  /**
   * Send the statement on WhatsApp — the way a khata actually reaches a
   * customer. Without a phone number the text is copied instead, so the shop
   * can paste it into any chat.
   */
  function share() {
    if (!party || !view) return;
    const text = statementText(party, view, period, periodKey, customer);
    const digits = String(party.phone ?? "").replace(/\D/g, "");
    if (digits) {
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      return;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setCopied(true))
        .catch(() => setCopied(false));
    }
  }

  const rows = view ? [...view.rows].reverse() : [];
  const trend = pctChange(byMonth.thisMonth.billed, byMonth.lastMonth.billed);
  const owes = (view?.balance ?? 0) > 0.005;

  return (
    <Page
      title="Khata"
      subtitle={
        customer
          ? "What each customer owes, with the full statement behind every balance."
          : "What the shop owes each supplier, with the full statement behind every balance."
      }
      action={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={exportCSV} disabled={!view}>
            Export CSV
          </button>
          <button
            className="btn btn-ghost"
            disabled={!view}
            onClick={() => party && view && printReport(party.name, "Statement")}
          >
            Print / PDF
          </button>
          <button className="btn btn-ghost" onClick={share} disabled={!view}>
            {copied ? "Copied to clipboard" : "Send on WhatsApp"}
          </button>
        </div>
      }
    >
      <div className="tabs">
        {(["customer", "vendor"] as PartyType[]).map((t) => (
          <button
            key={t}
            className={`tab ${partyType === t ? "active" : ""}`}
            onClick={() => switchType(t)}
          >
            {t === "customer" ? "Customer khata" : "Supplier khata"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div
          className="card"
          style={{ width: 270, flexShrink: 0, padding: 12, maxHeight: "calc(100vh - 230px)", overflow: "auto" }}
        >
          <input
            className="input"
            placeholder={customer ? "Search customers..." : "Search suppliers..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            {loadingParties ? (
              <div style={{ padding: 12, fontSize: "0.8rem", color: "#64748b" }}>Loading...</div>
            ) : !filtered.length ? (
              <div style={{ padding: 12, fontSize: "0.8rem", color: "#64748b" }}>
                {search ? "Nobody matches that." : `No ${customer ? "customers" : "suppliers"} yet.`}
              </div>
            ) : (
              filtered.map((p) => {
                const active = party?.party_id === p.party_id;
                const due = p.balance > 0.005;
                const inCredit = p.balance < -0.005;
                return (
                  <button
                    key={p.party_id}
                    onClick={() => selectParty(p.party_id)}
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                      border: `1px solid ${active ? "var(--color-primary)" : "#e2e8f0"}`,
                      background: active ? "#eff6ff" : "white",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{p.name}</span>
                      <span
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          color: due ? "#b91c1c" : inCredit ? "#15803d" : "#64748b",
                        }}
                      >
                        {due || inCredit ? currency(Math.abs(p.balance)) : "—"}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                      {p.phone || "No phone"}
                      {due ? ` · ${customer ? "owes you" : "you owe"}` : ""}
                      {inCredit ? " · in credit" : ""}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {!party ? (
            <div className="card">
              <EmptyState
                title={customer ? "No customers yet" : "No suppliers yet"}
                message={
                  customer
                    ? "Add a customer, then their statement will appear here."
                    : "Add a supplier, then their statement will appear here."
                }
              />
            </div>
          ) : (
            <>
              <div
                className="card"
                style={{
                  marginBottom: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{party.name}</div>
                  <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
                    {party.phone || "No phone on file"}
                    {party.last_entry_at ? ` · last entry ${d(party.last_entry_at)}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {!view ? "" : owes ? (customer ? "Owes you" : "You owe") : "Settled in full"}
                  </div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 800, color: owes ? "#b91c1c" : "#15803d" }}>
                    {view ? currency(Math.abs(view.balance)) : "—"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setError("");
                      setEntry("payment");
                    }}
                  >
                    {customer ? "Record payment" : "Pay supplier"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setError("");
                      setEntry("bill");
                    }}
                  >
                    {customer ? "Bill on account" : "Purchase on account"}
                  </button>
                </div>
              </div>

              <div
                className="card"
                style={{
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: "0.78rem", color: "#64748b" }}>Period</span>
                <select
                  className="input"
                  style={{ width: 170 }}
                  value={periodKey}
                  onChange={(e) => setPeriodKey(e.target.value as PeriodKey)}
                >
                  {PERIODS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {periodKey === "custom" && (
                  <>
                    <input
                      className="input"
                      style={{ width: 155 }}
                      type="date"
                      value={custom.from}
                      onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                    />
                    <span style={{ fontSize: "0.78rem", color: "#64748b" }}>to</span>
                    <input
                      className="input"
                      style={{ width: 155 }}
                      type="date"
                      value={custom.to}
                      onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                    />
                  </>
                )}
                <div style={{ marginLeft: "auto", display: "flex", gap: 20, alignItems: "flex-end" }}>
                  <div>
                    <div className="stat-label">{customer ? "Billed" : "Purchased"}</div>
                    <div style={{ fontWeight: 700 }}>{view ? currency(view.totalDebit) : "—"}</div>
                  </div>
                  <div>
                    <div className="stat-label">{customer ? "Received" : "Paid"}</div>
                    <div style={{ fontWeight: 700 }}>{view ? currency(view.totalCredit) : "—"}</div>
                  </div>
                  <div>
                    <div className="stat-label">This month</div>
                    <div style={{ fontWeight: 700 }}>
                      {currency(byMonth.thisMonth.billed)}
                      {trend != null && (
                        <span
                          style={{
                            fontSize: "0.72rem",
                            marginLeft: 6,
                            color: trend >= 0 ? "#15803d" : "#b91c1c",
                          }}
                        >
                          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "#64748b" }}>
                      last month {currency(byMonth.lastMonth.billed)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                {loadingStatement ? (
                  <div style={{ padding: 28, textAlign: "center", color: "#64748b" }}>
                    Loading statement...
                  </div>
                ) : !rows.length ? (
                  <div style={{ padding: 16 }}>
                    <EmptyState
                      title="Nothing in this period"
                      message={
                        periodKey === "all"
                          ? "No entries on this khata yet."
                          : "Try a wider period, or add the first entry."
                      }
                    />
                  </div>
                ) : (
                  <div className="table-wrap" style={{ maxHeight: 460, overflow: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: 110 }}>Date</th>
                          <th>Particulars</th>
                          <th style={{ textAlign: "right", width: 120 }}>Debit</th>
                          <th style={{ textAlign: "right", width: 120 }}>Credit</th>
                          <th style={{ textAlign: "right", width: 120 }}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {period.from && (
                          <tr style={{ background: "#f8fafc" }}>
                            <td>{d(period.from)}</td>
                            <td>
                              <b>Balance b/d</b>
                            </td>
                            <td style={{ textAlign: "right" }} />
                            <td style={{ textAlign: "right" }} />
                            <td style={{ textAlign: "right", fontWeight: 700 }}>
                              {currency(view!.opening)}
                            </td>
                          </tr>
                        )}
                        {rows.map((r) => (
                          <tr key={r.id}>
                            <td>{d(r.occurred_at)}</td>
                            <td>
                              <div style={{ fontWeight: 500 }}>
                                {kindLabel(r, customer)}
                                {r.order_id ? ` #${r.order_id}` : ""}
                              </div>
                              {r.note && (
                                <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{r.note}</div>
                              )}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {r.direction === "debit" ? currency(r.amount) : ""}
                            </td>
                            <td style={{ textAlign: "right", color: "#15803d" }}>
                              {r.direction === "credit" ? currency(r.amount) : ""}
                            </td>
                            <td
                              style={{
                                textAlign: "right",
                                fontWeight: 600,
                                color:
                                  r.running > 0.005
                                    ? "#b91c1c"
                                    : r.running < -0.005
                                      ? "#15803d"
                                      : undefined,
                              }}
                            >
                              {currency(r.running)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: "2px solid #0f172a" }}>
                          <td colSpan={2}>
                            <b>Total · {periodLabel(period, periodKey)}</b>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <b>{currency(view!.totalDebit)}</b>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <b>{currency(view!.totalCredit)}</b>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <b>{currency(view!.balance)}</b>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {monthly.length > 0 && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="stat-label" style={{ marginBottom: 8 }}>
                    Last {monthly.length} months
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {monthly.map((m) => (
                      <div
                        key={m.month}
                        style={{
                          flex: "1 1 130px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          padding: "8px 10px",
                        }}
                      >
                        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          {monthLabel(m.month)}
                        </div>
                        <div style={{ fontWeight: 700 }}>{currency(m.billed)}</div>
                        <div style={{ fontSize: "0.72rem", color: "#15803d" }}>
                          {currency(m.settled)} {customer ? "received" : "paid"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {entry && party && (
        <PostEntryModal
          kind={entry}
          partyType={partyType}
          partyName={party.name}
          balance={view?.balance ?? party.balance}
          accounts={accounts}
          saving={post.isPending}
          error={error}
          onClose={() => {
            setEntry(null);
            setError("");
          }}
          onSubmit={(input) => post.mutate(input)}
        />
      )}

      {/* Print-only statement. Portalled to <body> so the print rules cannot be
          clipped by this page's scroll containers — the blank-PDF bug the
          Reports page already hit once. Hidden on screen. */}
      {party &&
        view &&
        createPortal(
          <div className="report-print" style={{ padding: 24, background: "white", color: "#0f172a" }}>
            <div style={{ borderBottom: "2px solid #0f172a", paddingBottom: 8, marginBottom: 12 }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{shop?.[0]?.name ?? "Lubric POS"}</div>
              <div style={{ fontSize: "0.78rem", color: "#475569" }}>
                {[shop?.[0]?.address, shop?.[0]?.phone].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div style={{ textAlign: "center", marginBottom: 10 }}>
              <div
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Statement of account
              </div>
              <div style={{ fontSize: "0.85rem", color: "#334155" }}>
                {party.name}
                {party.phone ? ` · ${party.phone}` : ""}
              </div>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#475569", marginBottom: 10 }}>
              <div>Period: {periodLabel(period, periodKey)}</div>
              {period.from && <div>Balance brought forward: {currency(view.opening)}</div>}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr>
                  {["Date", "Particulars", "Debit", "Credit", "Balance"].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        borderBottom: "1.5px solid #0f172a",
                        textAlign: i === 0 || i === 1 ? "left" : "right",
                        padding: "5px 6px",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {period.from && (
                  <tr>
                    <td style={{ padding: "4px 6px" }}>—</td>
                    <td style={{ padding: "4px 6px" }}>Balance b/d</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }} />
                    <td style={{ padding: "4px 6px", textAlign: "right" }} />
                    <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700 }}>
                      {currency(view.opening)}
                    </td>
                  </tr>
                )}
                {view.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid #e2e8f0" }}>
                      {d(r.occurred_at)}
                    </td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid #e2e8f0" }}>
                      {kindLabel(r, customer)}
                      {r.note ? ` — ${r.note}` : ""}
                    </td>
                    <td
                      style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}
                    >
                      {r.direction === "debit" ? currency(r.amount) : ""}
                    </td>
                    <td
                      style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}
                    >
                      {r.direction === "credit" ? currency(r.amount) : ""}
                    </td>
                    <td
                      style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}
                    >
                      {currency(r.running)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 10, marginLeft: "auto", width: 280 }}>
              {(
                [
                  ["Total billed", currency(view.totalDebit)],
                  ["Total settled", currency(view.totalCredit)],
                  [
                    owes ? (customer ? "Amount due" : "Amount payable") : "Balance",
                    currency(view.balance),
                  ],
                ] as [string, string][]
              ).map(([k, v], i) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "3px 6px",
                    fontWeight: 700,
                    fontSize: "0.8rem",
                    borderTop: i === 2 ? "2px solid #0f172a" : "1px solid #e2e8f0",
                  }}
                >
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 34,
                fontSize: "0.7rem",
              }}
            >
              <div>
                _______________________
                <br />
                Signature
              </div>
              <div style={{ textAlign: "right" }}>
                _______________________
                <br />
                Date
              </div>
            </div>
            <div
              style={{ marginTop: 24, fontSize: "0.7rem", color: "#94a3b8", textAlign: "center" }}
            >
              Generated {new Date().toLocaleString()} · Lubric POS
            </div>
          </div>,
          document.body
        )}
    </Page>
  );
}
