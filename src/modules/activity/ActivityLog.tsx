import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "../../lib/db";
import { useAuth } from "../../lib/auth";
import { Page } from "../../components/Page";
import { EmptyState } from "../../components/EmptyState";

/**
 * Activity Log — admin-only (Umar, 2026-11-28).
 *
 * Every action a team member takes lands in activity_log (see
 * src/lib/activityLog.ts): add / edit / delete / view / void / login,
 * with the member's name and a short detail. This page reads it
 * newest-first, with filters by member, action and date.
 *
 * The route (/activity) is admin-gated in App.tsx and the API only
 * serves activity_log reads to admin/owner (server/index.js) — the
 * isAdmin check here is the third layer, so a non-admin who somehow
 * renders the component sees a closed door instead of rows.
 */
const ACTIONS = ["", "add", "edit", "delete", "view", "void", "login"] as const;

interface LogRow {
  id: number;
  user_name: string;
  action: string;
  entity: string;
  entity_id: number | null;
  detail: string;
  created_at: string;
}

const DAY = "substr(created_at::text, 1, 10)";

export default function ActivityLog() {
  const { isAdmin } = useAuth();
  const [member, setMember] = useState("");
  const [action, setAction] = useState("");
  const [df, setDf] = useState("");
  const [dt, setDt] = useState("");

  // Member filter options come from the log itself, not the users table:
  // the log denormalises the name at write time, so it stays readable
  // after a member is renamed or removed — and reading it needs no
  // team.manage key beyond the admin gate this page already sits behind.
  const { data: members } = useQuery({
    queryKey: ["activity_members"],
    queryFn: () =>
      dbSelect<{ user_name: string }>(
        "SELECT DISTINCT user_name FROM activity_log WHERE user_name <> '' ORDER BY user_name"
      ),
    enabled: isAdmin,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["activity_log", member, action, df, dt],
    queryFn: () => {
      const p: unknown[] = [];
      let w = "WHERE 1=1";
      if (member) { p.push(member); w += ` AND user_name = $${p.length}`; }
      if (action) { p.push(action); w += ` AND action = $${p.length}`; }
      if (df) { p.push(df); w += ` AND ${DAY} >= $${p.length}`; }
      if (dt) { p.push(dt); w += ` AND ${DAY} <= $${p.length}`; }
      return dbSelect<LogRow>(
        `SELECT id, user_name, action, entity, entity_id, detail, created_at
         FROM activity_log ${w}
         ORDER BY created_at DESC, id DESC
         LIMIT 500`,
        p
      );
    },
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <Page title="Activity Log">
        <EmptyState title="Admin only" message="The activity log is only visible to the admin account." />
      </Page>
    );
  }

  return (
    <Page
      title="Activity Log"
      subtitle="Everything each team member did — add, edit, view, delete, void and sign-ins, newest first"
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select className="input" value={member} onChange={(e) => setMember(e.target.value)} style={{ width: 180 }}>
          <option value="">All members</option>
          {(members ?? []).map((m) => (
            <option key={m.user_name} value={m.user_name}>{m.user_name}</option>
          ))}
        </select>
        <select className="input" value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 140 }}>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a === "" ? "All actions" : a}</option>
          ))}
        </select>
        <input className="input" type="date" value={df} onChange={(e) => setDf(e.target.value)} title="From date" />
        <input className="input" type="date" value={dt} onChange={(e) => setDt(e.target.value)} title="To date" />
        {(member || action || df || dt) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setMember(""); setAction(""); setDf(""); setDt(""); }}>
            Clear
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: "#64748b" }}>
          {rows.length} entries
        </span>
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40 }}>Loading...</div>
      ) : !rows.length ? (
        <EmptyState title="No activity yet" message="Actions your team takes will appear here." />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>When</th><th>Member</th><th>Action</th><th>What</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}>{r.created_at?.slice(0, 19).replace("T", " ")}</td>
                  <td style={{ fontWeight: 500 }}>{r.user_name || "—"}</td>
                  <td>
                    <span style={{ fontSize: "0.75rem", padding: "1px 7px", borderRadius: 4, background: r.action === "delete" || r.action === "void" ? "#fee2e2" : "#e0f2fe", color: r.action === "delete" || r.action === "void" ? "#991b1b" : "#0369a1" }}>
                      {r.action}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.85rem" }}>{r.entity}{r.entity_id ? ` #${r.entity_id}` : ""}</td>
                  <td style={{ fontSize: "0.85rem", color: "#475569" }}>{r.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
