import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbExecute } from "../../lib/db";
import { Page } from "../../components/Page";
import { Modal } from "../../components/Modal";
import { ReminderModal, ReminderDraft } from "../../components/ReminderModal";
import { EmptyState } from "../../components/EmptyState";
import { REMINDER_SELECT, REMINDER_KINDS, kindMeta, relativeDue, priorityColor, bucketOf, ReminderWithRefs } from "../../lib/reminders";
import type { ReminderKind } from "../../lib/types";

type Tab = "all" | "overdue" | "today" | "upcoming" | "done" | "dismissed";

export default function Reminders() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const [kindFilter, setKindFilter] = useState<ReminderKind | "">("");
  const [modal, setModal] = useState<ReminderDraft | null>(null);
  const [showModal, setShowModal] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["reminders", "page", tab, kindFilter],
    queryFn: async () => {
      const all = await dbSelect<ReminderWithRefs>(`${REMINDER_SELECT} ORDER BY
        CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
        CASE WHEN r.due_at IS NULL THEN 1 ELSE 0 END,
        r.due_at ASC NULLS LAST,
        r.id DESC`);
      return all;
    },
    refetchInterval: 30_000,
  });

  async function act(id: number, mode: "done" | "dismissed") {
    await dbExecute(
      `WITH d AS (UPDATE reminders SET status=$2, completed_at=now(), updated_at=now() WHERE id=$1 RETURNING *)
       INSERT INTO reminders (shop_id, kind, title, details, due_at, due_km, last_mileage,
         customer_id, vehicle_id, vendor_id, order_id, priority, recurrence_days, created_by_user_id)
       SELECT shop_id, kind, title, details, due_at + (recurrence_days || ' days')::interval,
         due_km, last_mileage, customer_id, vehicle_id, vendor_id, order_id, priority,
         recurrence_days, created_by_user_id
       FROM d WHERE $2 = 'done' AND recurrence_days IS NOT NULL`,
      [id, mode]
    );
    qc.invalidateQueries({ queryKey: ["reminders"] });
    qc.invalidateQueries({ queryKey: ["reminder_counts"] });
  }

  async function reopen(id: number) {
    await dbExecute(
      "UPDATE reminders SET status='pending', completed_at=NULL, updated_at=now() WHERE id=$1",
      [id]
    );
    qc.invalidateQueries({ queryKey: ["reminders"] });
  }

  if (isLoading) return <Page title="Reminders"><div style={{ textAlign: "center", padding: 40 }}>Loading...</div></Page>;

  const filtered = (rows ?? []).filter((r) => {
    if (kindFilter && r.kind !== kindFilter) return false;
    switch (tab) {
      case "overdue":   return r.status === "pending" && bucketOf(r) === "overdue";
      case "today":     return r.status === "pending" && bucketOf(r) === "today";
      case "upcoming":  return r.status === "pending" && bucketOf(r) === "upcoming";
      case "done":      return r.status === "done";
      case "dismissed": return r.status === "dismissed";
      default:          return true;
    }
  });

  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const counts = {
    overdue: pending.filter((r) => bucketOf(r) === "overdue").length,
    today: pending.filter((r) => bucketOf(r) === "today").length,
    upcoming: pending.filter((r) => bucketOf(r) === "upcoming").length,
    done: (rows ?? []).filter((r) => r.status === "done").length,
    dismissed: (rows ?? []).filter((r) => r.status === "dismissed").length,
  };

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: (rows ?? []).length },
    { key: "overdue", label: "🔴 Overdue", count: counts.overdue },
    { key: "today", label: "🟡 Today", count: counts.today },
    { key: "upcoming", label: "🔵 Upcoming", count: counts.upcoming },
    { key: "done", label: "✓ Done", count: counts.done },
    { key: "dismissed", label: "Dismissed", count: counts.dismissed },
  ];

  return (
    <Page
      title="Reminders"
      subtitle="Service due dates, vendor meetings, credit follow-ups and your to-do list"
      action={
        <button className="btn btn-primary" onClick={() => { setModal({}); setShowModal(true); }}>
          + New Reminder
        </button>
      }
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: "4px 12px", borderRadius: 16, fontSize: "0.8rem", cursor: "pointer",
              border: "1px solid " + (tab === t.key ? "#2563eb" : "#e2e8f0"),
              background: tab === t.key ? "#eff6ff" : "white",
              color: tab === t.key ? "#2563eb" : "#475569",
              fontWeight: tab === t.key ? 600 : 400,
            }}>
            {t.label} ({t.count})
          </button>
        ))}
        <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: "0.8rem" }}
          value={kindFilter} onChange={(e) => setKindFilter(e.target.value as ReminderKind | "")}>
          <option value="">All types</option>
          {REMINDER_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={tab === "all" ? "No reminders yet" : "Nothing here"}
          message={tab === "all" ? "Set your first reminder — a service due date, a vendor meeting, or a to-do" : "No reminders in this view"}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th></th><th>Reminder</th><th>Due</th><th>For</th><th>Priority</th><th style={{ width: 210 }}></th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const meta = kindMeta(r.kind);
                const b = bucketOf(r);
                const done = r.status === "done";
                return (
                  <tr key={r.id} style={{ opacity: done || r.status === "dismissed" ? 0.55 : 1 }}>
                    <td style={{ width: 24 }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: priorityColor(r.priority) }} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, textDecoration: done ? "line-through" : "none" }}>
                        {meta.icon} {r.title}
                        {r.recurrence_days ? <span style={{ fontSize: "0.7rem", color: "#64748b", marginLeft: 6 }}>↻ every {r.recurrence_days}d</span> : null}
                      </div>
                      {r.details ? <div style={{ fontSize: "0.78rem", color: "#64748b" }}>{r.details}</div> : null}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 600,
                        color: r.status === "pending" && b === "overdue" ? "#dc2626" : r.status === "pending" && b === "today" ? "#d97706" : "#334155" }}>
                        {relativeDue(r.due_at)}
                      </div>
                      {r.due_km ? <div style={{ fontSize: "0.72rem", color: "#64748b" }}>at {r.due_km.toLocaleString()} km</div> : null}
                    </td>
                    <td style={{ fontSize: "0.8rem" }}>{r.about}</td>
                    <td>
                      <span style={{ fontSize: "0.72rem", padding: "1px 8px", borderRadius: 10,
                        background: r.priority === "high" ? "#fee2e2" : r.priority === "low" ? "#f1f5f9" : "#fef3c7",
                        color: r.priority === "high" ? "#b91c1c" : r.priority === "low" ? "#64748b" : "#92400e" }}>
                        {r.priority}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        {r.status === "pending" ? (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => { setModal({
                              id: r.id, kind: r.kind, title: r.title, details: r.details, due_at: r.due_at,
                              due_km: r.due_km, customer_id: r.customer_id, vehicle_id: r.vehicle_id,
                              vendor_id: r.vendor_id, priority: r.priority, recurrence_days: r.recurrence_days,
                            }); setShowModal(true); }}>Edit</button>
                            <button className="btn btn-sm" style={{ background: "#16a34a", color: "white", border: "none", borderRadius: 4, cursor: "pointer", padding: "4px 10px" }}
                              onClick={() => act(r.id, "done")}>✓ Done</button>
                            <button className="btn btn-ghost btn-sm" title="Dismiss" onClick={() => act(r.id, "dismissed")}>✕</button>
                          </>
                        ) : (
                          <button className="btn btn-ghost btn-sm" onClick={() => reopen(r.id)}>
                            {done ? "Reopen" : "Restore"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ReminderModal open={showModal} onClose={() => { setShowModal(false); setModal(null); }} initial={modal} />
    </Page>
  );
}
