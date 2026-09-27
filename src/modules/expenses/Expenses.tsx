import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbTransaction } from "../../lib/db";
import { currency } from "../../lib/format";
import { Page } from "../../components/Page";
import { Modal } from "../../components/Modal";
import { FormField } from "../../components/FormField";
import { EmptyState } from "../../components/EmptyState";
import { useAuth } from "../../lib/auth";
import { PERMISSIONS } from "../../lib/permissions";
import { downloadCSV } from "../../lib/export";

/**
 * Expense taxonomy. `key` lands in expenses.category, the sub items in
 * expenses.subcategory — so extending this list is all it takes to add a type.
 */
const CATEGORIES = [
  { key: "Shop", icon: "🏪", color: "#64748b", subs: ["Rent", "Electricity", "Water/Gas", "Internet", "Maintenance", "Upgradation", "Other"] },
  { key: "Food", icon: "☕", color: "#f59e0b", subs: ["Tea", "Food", "Juices", "Water", "Other"] },
  { key: "Commute", icon: "🚗", color: "#3b82f6", subs: ["Owner", "Staff", "Delivery", "Fuel", "Other"] },
  { key: "Salary", icon: "👷", color: "#8b5cf6", subs: ["Staff", "Owner", "Advance", "Other"] },
  { key: "Supplies", icon: "📦", color: "#14b8a6", subs: ["Cleaning", "Filters", "Motors", "Oil", "Tools", "Other"] },
  { key: "Other", icon: "🧾", color: "#94a3b8", subs: ["Marketing", "Bank Charges", "Miscellaneous", "Other"] },
];

function meta(key: string) {
  return CATEGORIES.find((c) => c.key === key) ?? { key, icon: "🧾", color: "#94a3b8", subs: ["Other"] };
}

/** expenses.date is free text; fall back to the created day when it is blank. */
const DAY = "COALESCE(NULLIF(e.date, ''), to_char(e.created_at, 'YYYY-MM-DD'))";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function blankForm(accountId: number) {
  return { category: "Shop", subcategory: "", amount: "", date: today(), note: "", account_id: accountId };
}

interface Expense {
  id: number;
  category: string;
  subcategory: string | null;
  amount: number;
  account_id: number | null;
  date: string | null;
  note: string | null;
  created_at: string;
  day: string;
  account_name: string | null;
}

export default function Expenses() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(PERMISSIONS.EXPENSES_MANAGE);

  const [df, setDf] = useState("");
  const [dt, setDt] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(() => blankForm(1));

  const { data: accounts } = useQuery({
    queryKey: ["exp-accounts"],
    queryFn: () => dbSelect<{ id: number; name: string }>("SELECT id, name FROM accounts WHERE active = 1 ORDER BY name"),
  });

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses", df, dt, catFilter],
    queryFn: () => {
      const p: unknown[] = [];
      let w = "WHERE 1=1";
      if (df) { p.push(df); w += ` AND ${DAY} >= $${p.length}`; }
      if (dt) { p.push(dt); w += ` AND ${DAY} <= $${p.length}`; }
      if (catFilter) { p.push(catFilter); w += ` AND e.category = $${p.length}`; }
      return dbSelect<Expense>(
        `SELECT e.id, e.category, e.subcategory, e.amount, e.account_id, e.date, e.note, e.created_at,
                ${DAY} AS day, a.name AS account_name
         FROM expenses e
         LEFT JOIN accounts a ON a.id = e.account_id
         ${w}
         ORDER BY ${DAY} DESC, e.id DESC
         LIMIT 500`,
        p
      );
    },
  });

  const accountId = accounts?.[0]?.id ?? 1;

  const catTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const e of expenses ?? []) {
      const k = e.category || "Other";
      t[k] = (t[k] ?? 0) + Number(e.amount || 0);
    }
    return t;
  }, [expenses]);

  const grandTotal = useMemo(
    () => Object.values(catTotals).reduce((s, v) => s + v, 0),
    [catTotals]
  );

  /** "Expense: Shop / Rent" — keeps the account ledger readable. */
  function label(category: string, subcategory: string) {
    return `Expense: ${category}${subcategory ? " / " + subcategory : ""}`;
  }

  function close() {
    setOpen(false);
    setEditId(null);
    setForm(blankForm(accountId));
  }

  function openAdd() {
    setEditId(null);
    setForm(blankForm(accountId));
    setOpen(true);
  }

  function openEdit(e: Expense) {
    setEditId(e.id);
    setForm({
      category: e.category || "Shop",
      subcategory: e.subcategory ?? "",
      amount: String(e.amount ?? ""),
      date: e.date || e.day || today(),
      note: e.note ?? "",
      account_id: e.account_id ?? accountId,
    });
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(form.amount);
      if (!amount || amount <= 0) throw new Error("Enter an amount greater than zero");
      if (!form.account_id) throw new Error("Choose the account the money left from");
      const ref = label(form.category, form.subcategory);

      if (editId) {
        // Reverse the original posting first, then record the corrected one.
        const before = (expenses ?? []).find((x) => x.id === editId);
        const oldAmount = Number(before?.amount ?? 0);
        const oldAccount = before?.account_id ?? form.account_id;

        await dbTransaction([
          { sql: "UPDATE accounts SET balance = balance + $1 WHERE id = $2", params: [oldAmount, oldAccount] },
          { sql: "UPDATE accounts SET balance = balance - $1 WHERE id = $2", params: [amount, form.account_id] },
          {
            sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'in',$3)",
            params: [oldAccount, oldAmount, `Expense edit reversal: ${before?.category ?? ""}`],
          },
          {
            sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'out',$3)",
            params: [form.account_id, amount, ref],
          },
          {
            sql: "UPDATE expenses SET category=$1, subcategory=$2, amount=$3, account_id=$4, date=$5, note=$6 WHERE id=$7",
            params: [form.category, form.subcategory, amount, form.account_id, form.date, form.note, editId],
          },
        ]);
      } else {
        await dbTransaction([
          {
            sql: "INSERT INTO expenses (shop_id, category, subcategory, amount, account_id, date, note) VALUES (1,$1,$2,$3,$4,$5,$6)",
            params: [form.category, form.subcategory, amount, form.account_id, form.date, form.note],
          },
          { sql: "UPDATE accounts SET balance = balance - $1 WHERE id = $2", params: [amount, form.account_id] },
          {
            sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'out',$3)",
            params: [form.account_id, amount, ref],
          },
        ]);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries();
      close();
    },
    onError: (e: unknown) =>
      alert("Could not save expense: " + (e instanceof Error ? e.message : String(e))),
  });

  const del = useMutation({
    mutationFn: async (e: Expense) => {
      await dbTransaction([
        { sql: "UPDATE accounts SET balance = balance + $1 WHERE id = $2", params: [e.amount, e.account_id] },
        { sql: "DELETE FROM expenses WHERE id = $1", params: [e.id] },
        {
          sql: "INSERT INTO account_transactions (account_id, amount, type, reference) VALUES ($1,$2,'in',$3)",
          params: [e.account_id, e.amount, `Expense deleted: ${e.category}${e.subcategory ? " / " + e.subcategory : ""}`],
        },
      ]);
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (err: unknown) =>
      alert("Could not delete: " + (err instanceof Error ? err.message : String(err))),
  });

  const subs = meta(form.category).subs;

  function exportCsv() {
    downloadCSV(
      `expenses-${df || "all"}-${dt || "all"}.csv`,
      ["Date", "Category", "Subcategory", "Note", "Amount", "Account"],
      (expenses ?? []).map((e) => [
        e.day,
        e.category,
        e.subcategory ?? "",
        e.note ?? "",
        e.amount,
        e.account_name ?? "",
      ])
    );
  }

  return (
    <Page
      title="Expenses"
      subtitle="Shop, food, commute, salary and supplies — every entry also moves the account ledger"
      action={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={exportCsv} disabled={!expenses?.length}>
            Export CSV
          </button>
          {canManage && (
            <button className="btn btn-primary" onClick={openAdd}>
              + Add Expense
            </button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" type="date" value={df} onChange={(e) => setDf(e.target.value)} title="From date" />
        <input className="input" type="date" value={dt} onChange={(e) => setDt(e.target.value)} title="To date" />
        <select className="input" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ width: 155 }}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.icon} {c.key}</option>
          ))}
        </select>
        {(df || dt || catFilter) && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setDf(""); setDt(""); setCatFilter(""); }}
          >
            Clear
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: "#64748b" }}>
          {expenses?.length ?? 0} entries
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 16 }}>
        {CATEGORIES.map((c) => {
          const total = catTotals[c.key] ?? 0;
          const active = catFilter === c.key;
          return (
            <button
              key={c.key}
              className="card"
              onClick={() => setCatFilter(active ? "" : c.key)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                padding: "10px 12px",
                background: active ? "#e2e8f0" : "white",
                border: `1px solid ${active ? "#94a3b8" : "#e2e8f0"}`,
              }}
            >
              <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{c.icon} {c.key}</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: total > 0 ? "#dc2626" : "#94a3b8" }}>
                {currency(total)}
              </div>
            </button>
          );
        })}
        <div className="card" style={{ padding: "10px 12px", background: "#0f172a", border: "1px solid #0f172a" }}>
          <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Period total</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "white" }}>{currency(grandTotal)}</div>
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40 }}>Loading...</div>
      ) : !expenses?.length ? (
        <EmptyState title="No expenses" message="Add your first expense — rent, tea, commute, all of it" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {expenses.map((e) => {
            const m = meta(e.category);
            return (
              <div
                key={e.id}
                className="card"
                style={{
                  padding: "10px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  borderLeft: `4px solid ${m.color}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{e.subcategory || e.category}</span>
                    <span style={{ fontSize: "0.7rem", padding: "1px 7px", borderRadius: 4, background: "#f1f5f9", color: "#475569" }}>
                      {m.icon} {e.category}
                    </span>
                    {e.note && <span style={{ fontSize: "0.78rem", color: "#64748b" }}>· {e.note}</span>}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 3 }}>
                    {e.day} · {e.account_name ?? "Cash"}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontWeight: 700, color: "#dc2626" }}>{currency(e.amount)}</span>
                  {canManage && (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(e)}>Edit</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: "#dc2626" }}
                        onClick={() => {
                          const what = `${e.category}${e.subcategory ? " / " + e.subcategory : ""}`;
                          if (confirm(`Delete this ${what} expense of ${currency(e.amount)}? The amount goes back to ${e.account_name ?? "the account"}.`)) {
                            del.mutate(e);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <Modal open={open} onClose={close} title={editId ? "Edit Expense" : "Add Expense"} wide>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Where did the money go?</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(105px, 1fr))", gap: 6 }}>
                {CATEGORIES.map((c) => (
                  <CatTile
                    key={c.key}
                    icon={c.icon}
                    label={c.key}
                    active={form.category === c.key}
                    onClick={() => setForm((f) => ({ ...f, category: c.key, subcategory: "" }))}
                  />
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                {meta(form.category).icon} {form.category} — what kind?
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {subs.map((s) => {
                  const on = form.subcategory === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, subcategory: on ? "" : s }))}
                      style={{
                        padding: "5px 12px",
                        borderRadius: 999,
                        cursor: "pointer",
                        fontSize: "0.82rem",
                        background: on ? "#cbd5e1" : "#f1f5f9",
                        border: `1px solid ${on ? "#94a3b8" : "#e2e8f0"}`,
                        color: on ? "#1e293b" : "#64748b",
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 130 }}>
                <FormField label="Amount" required>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0.00"
                  />
                </FormField>
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <FormField label="Date">
                  <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </FormField>
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <FormField label="Paid from">
                  <select
                    className="input"
                    value={form.account_id}
                    onChange={(e) => setForm({ ...form, account_id: Number(e.target.value) })}
                  >
                    {(accounts ?? []).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </FormField>
              </div>
            </div>

            <FormField label="Note">
              <input
                className="input"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Optional detail — who took it, what for"
              />
            </FormField>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving..." : editId ? "Save Changes" : "Add Expense"}
              </button>
              <button className="btn btn-ghost" onClick={close}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}

/** Big clickable category button used in the expense form. */
function CatTile({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 8px",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "center",
        fontSize: "0.84rem",
        background: active ? "#cbd5e1" : "#f8fafc",
        border: `1px solid ${active ? "#94a3b8" : "#e2e8f0"}`,
        color: active ? "#1e293b" : "#475569",
        fontWeight: active ? 600 : 400,
      }}
    >
      <div style={{ fontSize: "1.25rem" }}>{icon}</div>
      {label}
    </button>
  );
}


