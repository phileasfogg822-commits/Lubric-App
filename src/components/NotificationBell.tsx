import { useState, useRef, useEffect } from "react";
import type { CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { dbSelect, dbGet, dbExecute } from "../lib/db";
import { REMINDER_SELECT, kindMeta, relativeDue, priorityColor, bucketOf } from "../lib/reminders";
import type { ReminderWithRefs } from "../lib/reminders";

/**
 * Notification bell for the sidebar: overdue + due-today badge, polls every
 * 30 s, dropdown with the five most urgent items. Shares the "reminders"
 * query family with the dashboard so completing an item updates everywhere.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: urgent } = useQuery({
    queryKey: ["reminders", "bell"],
    queryFn: () =>
      dbSelect<ReminderWithRefs>(
        `${REMINDER_SELECT}
         WHERE r.status = 'pending'
           AND (r.due_at IS NULL OR r.due_at < now() + interval '7 days')
         ORDER BY CASE WHEN r.due_at IS NULL THEN 1 ELSE 0 END, r.due_at ASC
         LIMIT 5`
      ),
    refetchInterval: 30_000,
  });

  const { data: counts } = useQuery({
    queryKey: ["reminder_counts"],
    queryFn: async () => {
      const r = await dbGet<{ overdue: string; today: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE due_at < now()) AS overdue,
           COUNT(*) FILTER (WHERE due_at::date = now()::date AND due_at >= now()) AS today
         FROM reminders WHERE status = 'pending'`
      );
      return { overdue: Number(r?.overdue ?? 0), today: Number(r?.today ?? 0) };
    },
    refetchInterval: 30_000,
  });

  const badge = (counts?.overdue ?? 0) + (counts?.today ?? 0);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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

  const btn: CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 32, height: 32, borderRadius: 8, cursor: "pointer",
    background: open ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
    border: "none", color: "white", fontSize: 16, position: "relative", flexShrink: 0,
  };
  const badgeStyle: CSSProperties = {
    position: "absolute", top: -4, right: -4, minWidth: 16, height: 16,
    borderRadius: 8, background: "#dc2626", color: "white", fontSize: 10,
    fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
    padding: "0 4px",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button aria-label="Notifications" style={btn} onClick={() => setOpen((o) => !o)}>
        🔔
        {badge > 0 && <span style={badgeStyle}>{badge > 99 ? "99+" : badge}</span>}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: 38, left: 0, width: 320, maxHeight: 420, overflow: "auto",
          background: "white", color: "#0f172a", borderRadius: 10,
          boxShadow: "0 12px 32px rgba(15,23,42,0.25)", zIndex: 100, border: "1px solid #e2e8f0",
        }}>
          <div style={{ padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between" }}>
            <span>Notifications</span>
            <span style={{ fontSize: "0.72rem", fontWeight: 400, color: "#64748b" }}>{urgent?.length ?? 0} urgent</span>
          </div>

          {(!urgent || urgent.length === 0) && (
            <div style={{ padding: 16, textAlign: "center", color: "#16a34a", fontSize: "0.85rem" }}>
              ✓ Nothing urgent. All caught up!
            </div>
          )}

          {urgent?.map((r) => {
            const meta = kindMeta(r.kind);
            const overdue = bucketOf(r) === "overdue";
            return (
              <div key={r.id} style={{ padding: "8px 12px", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: priorityColor(r.priority), marginTop: 6, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.84rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {meta.icon} {r.title}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                      {r.about} · <span style={{ color: overdue ? "#dc2626" : "#2563eb", fontWeight: 600 }}>{relativeDue(r.due_at)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button className="btn btn-sm" style={{ padding: "2px 8px", fontSize: "0.7rem", background: "#16a34a", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
                        onClick={() => act(r.id, "done")}>✓ Done</button>
                      <button className="btn btn-sm" style={{ padding: "2px 8px", fontSize: "0.7rem", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 4, cursor: "pointer" }}
                        onClick={() => act(r.id, "dismissed")}>✕</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div style={{ padding: "8px 12px", textAlign: "center", borderTop: "1px solid #e2e8f0" }}>
            <button className="btn btn-ghost btn-sm" style={{ border: "none", cursor: "pointer", color: "#2563eb", fontSize: "0.8rem" }}
              onClick={() => { setOpen(false); navigate("/reminders"); }}>
              View all reminders →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
