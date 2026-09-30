import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbExecute } from "../../lib/db";
import { Page } from "../../components/Page";
import { Modal } from "../../components/Modal";
import { FormField } from "../../components/FormField";
import { EmptyState } from "../../components/EmptyState";
import { useAuth } from "../../lib/auth";
import { d } from "../../lib/format";
import { canManageDevices, countPhones, listDevices, type Device } from "../../lib/pairing";
import {
  ACTION_PERMISSIONS,
  MODULE_PERMISSIONS,
  PERMISSIONS,
  getDefaultPermissions,
  isAdminRole,
  parsePermissions,
  serializePermissions,
  type PermissionDef,
} from "../../lib/permissions";

interface Member {
  id: number;
  full_name: string;
  email: string;
  role: string;
  permissions: string | null;
}

const ROLE_OPTIONS = [
  { value: "cashier", label: "Cashier" },
  { value: "manager", label: "Manager" },
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
];

/** Fresh form state — a new member starts as a cashier (no bill edit/void/delete). */
function blankForm() {
  return {
    full_name: "",
    email: "",
    password: "",
    role: "cashier",
    permissions: getDefaultPermissions("cashier") as string[],
  };
}

/**
 * The phones attached to this shop, counted plainly.
 *
 * These are not user accounts - a field app has no login, it holds a device
 * token obtained by pairing - but for the owner's question ("how many phones
 * are connected, and which ones are actually sending data?") they belong
 * alongside the members. A phone that has never synced is called out, because
 * that is the one that looks fine and is silently holding someone's cash.
 */
function ConnectedPhones({ devices }: { devices: Device[] }) {
  const { paired, waiting } = countPhones(devices);
  const phones = devices.filter((x) => x.kind === "mobile" && x.status !== "revoked");

  return (
    <div className="card" style={{ marginBottom: 14, background: "#f8fafc" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "1.5rem", fontWeight: 800 }}>{paired}</span>
        <span style={{ fontWeight: 600 }}>
          paired phone{paired === 1 ? "" : "s"} connected
        </span>
        {waiting > 0 && (
          <span className="badge badge-yellow">{waiting} waiting to pair</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#94a3b8" }}>
          phones are managed in Shop Settings
        </span>
      </div>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        {phones.map((p) => (
          <div
            key={p.id}
            style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.82rem", flexWrap: "wrap" }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: p.status === "paired" ? "#16a34a" : "#eab308",
                display: "inline-block",
              }}
            />
            <span style={{ fontWeight: 500, minWidth: 130 }}>{p.name || `Phone #${p.id}`}</span>
            <span style={{ color: p.last_sync_at ? "#64748b" : "#b45309" }}>
              {p.last_sync_at ? `last sync ${d(p.last_sync_at)}` : "has never synced"}
            </span>
            {p.sync_requested_at && (
              <span className="badge badge-blue">asked to sync</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Team() {
  const qc = useQueryClient();
  const { hasPermission, user } = useAuth();
  const canManage = hasPermission(PERMISSIONS.TEAM_MANAGE);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(blankForm());

  const { data: members, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () =>
      dbSelect<Member>("SELECT id, full_name, email, role, permissions FROM users ORDER BY role, full_name"),
  });

  // Paired phones are people, from the shop's point of view: each one is a
  // signed-in collector holding its own cash. Shown here, next to the members,
  // so "who can collect money for this shop" is answered in one place rather
  // than by remembering there is a separate devices panel under Shop Settings.
  const { data: phones } = useQuery({
    queryKey: ["devices"],
    enabled: canManage && canManageDevices(),
    queryFn: listDevices,
  });

  function close() {
    setOpen(false);
    setEditId(null);
    setForm(blankForm());
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim() || !form.email.trim()) throw new Error("Name and email are required");
      if (!editId && !form.password.trim()) throw new Error("Password is required for a new member");

      const perms = serializePermissions(form.permissions);
      const name = form.full_name.trim();
      const email = form.email.trim();

      if (editId) {
        if (form.password.trim()) {
          await dbExecute(
            "UPDATE users SET full_name=$1, email=$2, role=$3, permissions=$4, password_hash=$5 WHERE id=$6",
            [name, email, form.role, perms, form.password, editId]
          );
        } else {
          await dbExecute(
            "UPDATE users SET full_name=$1, email=$2, role=$3, permissions=$4 WHERE id=$5",
            [name, email, form.role, perms, editId]
          );
        }
      } else {
        await dbExecute(
          "INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ($1,$2,$3,$4,$5)",
          [name, email, form.password, form.role, perms]
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries();
      close();
    },
    onError: (e: unknown) =>
      alert("Could not save member: " + (e instanceof Error ? e.message : String(e))),
  });

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setOpen(true);
  }

  function openEdit(m: Member) {
    setEditId(m.id);
    setForm({
      full_name: m.full_name ?? "",
      email: m.email ?? "",
      password: "",
      role: m.role ?? "cashier",
      // Admin/owner bypass every check, so their stored list is irrelevant.
      permissions: isAdminRole(m.role) ? [] : parsePermissions(m.permissions),
    });
    setOpen(true);
  }

  function onRoleChange(role: string) {
    // A new member follows the role. For an existing member we re-seed only when
    // nothing is ticked, so a hand-tuned set is never silently overwritten.
    setForm((f) =>
      !editId || f.permissions.length === 0
        ? { ...f, role, permissions: getDefaultPermissions(role) }
        : { ...f, role }
    );
  }

  function toggle(key: string) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((k) => k !== key)
        : [...f.permissions, key],
    }));
  }

  function toggleGroup(defs: PermissionDef[], on: boolean) {
    const keys = defs.map((d) => d.key as string);
    setForm((f) => ({
      ...f,
      permissions: on
        ? Array.from(new Set([...f.permissions, ...keys]))
        : f.permissions.filter((k) => !keys.includes(k)),
    }));
  }

  return (
    <Page
      title="Team & Access"
      subtitle="Add members and choose exactly what each person can do"
      action={
        canManage ? (
          <button className="btn btn-primary" onClick={openAdd}>
            + Add Member
          </button>
        ) : null
      }
    >
      {canManage && phones && phones.length > 0 && (
        <ConnectedPhones devices={phones} />
      )}

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40 }}>Loading...</div>
      ) : !members?.length ? (
        <EmptyState title="No members" message="Add your first team member" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {members.map((m) => {
            const admin = isAdminRole(m.role);
            const perms = parsePermissions(m.permissions);
            const isMe = user?.id === m.id;
            const canEditBills = perms.includes(PERMISSIONS.BILL_EDIT);
            const canDeleteBills = perms.includes(PERMISSIONS.BILL_DELETE);

            return (
              <div
                key={m.id}
                className="card"
                style={{
                  padding: "12px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderLeft: `3px solid ${admin ? "#60a5fa" : "#94a3b8"}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 38, height: 38, borderRadius: "50%", background: "#0f172a",
                        color: "white", display: "flex", alignItems: "center",
                        justifyContent: "center", fontWeight: 600,
                      }}
                    >
                      {m.full_name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {m.full_name}
                        {isMe && <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "#64748b" }}>(you)</span>}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
                        {m.email} · <span style={{ textTransform: "capitalize" }}>{m.role}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {admin && (
                      <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 4, background: "#dbeafe", color: "#1e40af", fontWeight: 600 }}>
                        Full access
                      </span>
                    )}
                    {canManage && (
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(m)}>
                        Edit &amp; Access
                      </button>
                    )}
                  </div>
                </div>

                {!admin && (
                  <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                    {perms.length ? `${perms.length} permission${perms.length === 1 ? "" : "s"} · ` : "No permissions · "}
                    <span style={{ color: canEditBills ? "#166534" : "#b45309" }}>
                      {canEditBills ? "can edit bills" : "cannot edit bills"}
                    </span>
                    {canDeleteBills && <span style={{ color: "#991b1b" }}> · can delete bills</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <Modal open={open} onClose={close} title={editId ? "Edit Member & Access" : "Add Team Member"} wide>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <FormField label="Full Name" required>
                  <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </FormField>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <FormField label="Email" required>
                  <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </FormField>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <FormField label="Role">
                  <select className="input" value={form.role} onChange={(e) => onRoleChange(e.target.value)}>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </FormField>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <FormField label={editId ? "New Password (blank = keep current)" : "Password"} required={!editId}>
                  <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </FormField>
              </div>
            </div>

            <div style={{ height: 1, background: "#e2e8f0", margin: "2px 0" }} />

            <PermissionGroup
              title="What they can open"
              defs={MODULE_PERMISSIONS}
              selected={form.permissions}
              onToggle={toggle}
              onToggleAll={toggleGroup}
            />

            <PermissionGroup
              title="What they can do to bills"
              note="A cashier can create bills but cannot edit, void or delete them until you tick those here."
              defs={ACTION_PERMISSIONS}
              selected={form.permissions}
              onToggle={toggle}
              onToggleAll={toggleGroup}
            />

            {isAdminRole(form.role) && (
              <div style={{ fontSize: "0.78rem", color: "#1e40af", background: "#dbeafe", padding: "8px 10px", borderRadius: 6 }}>
                Admin and owner always have full access — the ticks above are ignored for them.
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving..." : editId ? "Save Changes" : "Add Member"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setForm((f) => ({ ...f, permissions: getDefaultPermissions(f.role) }))}
              >
                Reset to {form.role} defaults
              </button>
              <button className="btn btn-ghost" onClick={close}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}

/** Checkbox grid with a select-all shortcut, used for both permission groups. */
function PermissionGroup({
  title,
  note,
  defs,
  selected,
  onToggle,
  onToggleAll,
}: {
  title: string;
  note?: string;
  defs: PermissionDef[];
  selected: string[];
  onToggle: (key: string) => void;
  onToggleAll: (defs: PermissionDef[], on: boolean) => void;
}) {
  const allOn = defs.every((d) => selected.includes(d.key));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{title}</div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => onToggleAll(defs, !allOn)}>
          {allOn ? "Clear all" : "Select all"}
        </button>
      </div>

      {note && <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 6 }}>{note}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 6 }}>
        {defs.map((d) => {
          const on = selected.includes(d.key);
          return (
            <label
              key={d.key}
              title={d.hint}
              style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "7px 10px", borderRadius: 6, cursor: "pointer",
                background: on ? "#e2e8f0" : "#f8fafc",
                border: `1px solid ${on ? "#94a3b8" : "#e2e8f0"}`,
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(d.key)}
                style={{ width: 15, height: 15, marginTop: 1, accentColor: "#475569" }}
              />
              <span style={{ fontSize: "0.84rem", color: on ? "#1e293b" : "#475569" }}>
                {d.label}
                {d.hint && <span style={{ display: "block", fontSize: "0.7rem", color: "#94a3b8" }}>{d.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
