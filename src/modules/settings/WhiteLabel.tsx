import { useEffect, useRef, useState } from "react";
import { apiBase, authHeaders } from "../../lib/db";
import { invalidateConfigCache } from "../../lib/configFlags";
import { useConfigMap, useFlagRows } from "../../lib/useConfigFlags";
import { moduleList } from "../../lib/configRules";

/**
 * White-label admin (Phase 1): branding, the module manifest, and the
 * feature flags a tenant's package runs with.
 *
 * Reads ride the shared config cache (so what is shown is what every other
 * screen already sees); writes go straight to the admin-gated REST PATCH
 * routes and then invalidate the cache — the sidebar, tab title, theme and
 * nav re-derive themselves live, which is the whole point of the screen.
 *
 * `dashboard` and `shop.manage` cannot be unchecked: they are the two keys
 * that keep this page reachable (nav needs them for the entry and the route),
 * so removing them would lock an owner out of their own white-label screen.
 *
 * Only keys this role can READ are edited — branding (public) and the
 * manifest (any session). Server-only secrets (payment gateway, DB env) stay
 * server-side: rendering them here would either leak them to shop managers
 * or let a half-visible form overwrite them with blanks.
 */

const MODULES: { key: string; label: string; locked?: boolean }[] = [
  { key: "dashboard", label: "Dashboard", locked: true },
  { key: "pos.create", label: "Point of Sale" },
  { key: "sales_history", label: "Transactions" },
  { key: "catalog.manage", label: "Catalog" },
  { key: "customers", label: "Customers" },
  { key: "vendors", label: "Vendors" },
  { key: "accounts", label: "Accounts" },
  { key: "expenses.manage", label: "Expenses" },
  { key: "purchase.manage", label: "Purchases" },
  { key: "inspections", label: "Inspections" },
  { key: "reports", label: "Reports" },
  { key: "profit_loss", label: "Profit & Loss" },
  { key: "team.manage", label: "Team & Access" },
  { key: "shop.manage", label: "Shop Settings", locked: true },
];

async function patchJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `PATCH ${path} failed (${res.status})`);
  }
}

type Toast = { kind: "ok" | "err"; text: string } | null;

export default function WhiteLabel() {
  const cfg = useConfigMap();
  const flags = useFlagRows();

  const [appName, setAppName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2563EB");
  const [modules, setModules] = useState<string[]>([]);
  const [brandDirty, setBrandDirty] = useState(false);
  const [modulesDirty, setModulesDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const hydrated = useRef(false);

  // Hydrate local form state ONCE, when config first arrives. Later cache
  // refreshes must not clobber an in-progress edit; saves update the locals
  // themselves. Every key touched here is readable by any session, so a
  // shop-manager's (non-admin) partial config view hydrates honestly.
  useEffect(() => {
    if (hydrated.current || Object.keys(cfg).length === 0) return;
    setAppName(cfg["app_name"] ?? "");
    setPrimaryColor(cfg["primary_color"] || "#2563EB");
    const list = moduleList(cfg["included_modules"]);
    setModules(list ?? MODULES.map((m) => m.key));
    hydrated.current = true;
  }, [cfg]);

  async function runSaving(fn: () => Promise<void>, okText: string) {
    setSaving(true);
    setToast(null);
    try {
      await fn();
      invalidateConfigCache(); // nav/title/theme re-derive live
      setToast({ kind: "ok", text: okText });
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  function saveBranding() {
    void runSaving(async () => {
      await patchJson(`/config/app_name`, { value: appName.trim() || "LubricApp" });
      await patchJson(`/config/primary_color`, { value: primaryColor });
      setBrandDirty(false);
    }, "Branding saved — applied everywhere already.");
  }

  function saveModules() {
    void runSaving(async () => {
      const next = new Set(modules);
      next.add("dashboard");
      next.add("shop.manage");
      await patchJson(`/config/included_modules`, { value: JSON.stringify([...next]) });
      setModules([...next]);
      setModulesDirty(false);
    }, "Module manifest saved — the nav now shows only included modules.");
  }

  function toggleFlag(key: string) {
    const row = flags.find((f) => f.key === key);
    if (!row) return;
    void runSaving(async () => {
      await patchJson(`/feature-flags/${encodeURIComponent(key)}`, { enabled: !row.enabled });
    }, `Flag ${key} ${row.enabled ? "disabled" : "enabled"}.`);
  }

  function toggleModule(key: string, on: boolean) {
    setModules((prev) => (on ? [...prev, key] : prev.filter((k) => k !== key)));
    setModulesDirty(true);
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 860 }}>
      <h1 style={{ fontSize: "1.35rem", fontWeight: 700, marginBottom: 4 }}>White Label</h1>
      <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
        Branding, modules, and feature flags for this deployment. Changes apply to every
        signed-in screen immediately.
      </p>

      {toast && (
        <div
          style={{
            padding: "0.6rem 0.9rem",
            borderRadius: 6,
            marginBottom: "1rem",
            fontSize: "0.85rem",
            background: toast.kind === "ok" ? "#dcfce7" : "#fee2e2",
            color: toast.kind === "ok" ? "#166534" : "#991b1b",
          }}
        >
          {toast.text}
        </div>
      )}

      {/* ── Branding ─────────────────────────────────────────────────────── */}
      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Branding</h2>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <label style={{ flex: "1 1 240px" }}>
            <span className="label">App name</span>
            <input
              className="input"
              value={appName}
              onChange={(e) => {
                setAppName(e.target.value);
                setBrandDirty(true);
              }}
              placeholder="LubricApp"
            />
          </label>
          <label style={{ flex: "0 0 140px" }}>
            <span className="label">Primary colour</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : "#2563eb"}
                onChange={(e) => {
                  setPrimaryColor(e.target.value.toUpperCase());
                  setBrandDirty(true);
                }}
                style={{ width: 42, height: 34, border: "1px solid var(--color-border)", borderRadius: 6, padding: 2, background: "var(--color-surface)" }}
              />
              <input
                className="input"
                value={primaryColor}
                onChange={(e) => {
                  setPrimaryColor(e.target.value);
                  setBrandDirty(true);
                }}
                style={{ width: 96 }}
              />
            </div>
          </label>
        </div>
        <div style={{ marginTop: "0.9rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button className="btn btn-primary" onClick={saveBranding} disabled={saving || !brandDirty}>
            Save branding
          </button>
          {brandDirty && (
            <span style={{ fontSize: "0.78rem", color: "var(--color-muted)" }}>Unsaved changes</span>
          )}
        </div>
      </section>

      {/* ── Modules ──────────────────────────────────────────────────────── */}
      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 4 }}>Included modules</h2>
        <p style={{ color: "var(--color-muted)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
          The package this deployment runs with: unchecked modules disappear from the nav
          and their pages stop opening for every role. Dashboard and Shop Settings stay on —
          they are how you get back here.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.5rem" }}>
          {MODULES.map((m) => {
            const on = modules.includes(m.key);
            return (
              <label
                key={m.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "0.85rem",
                  padding: "0.4rem 0.5rem",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  opacity: m.locked ? 0.65 : 1,
                  cursor: m.locked ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={m.locked || saving}
                  onChange={(e) => toggleModule(m.key, e.target.checked)}
                />
                {m.label}
                {m.locked && (
                  <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--color-muted)" }}>
                    required
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <div style={{ marginTop: "0.9rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button className="btn btn-primary" onClick={saveModules} disabled={saving || !modulesDirty}>
            Save modules
          </button>
          {modulesDirty && (
            <span style={{ fontSize: "0.78rem", color: "var(--color-muted)" }}>Unsaved changes</span>
          )}
        </div>
      </section>

      {/* ── Feature flags ────────────────────────────────────────────────── */}
      <section className="card">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 4 }}>Feature flags</h2>
        <p style={{ color: "var(--color-muted)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
          Runtime toggles, independent of the package above. Each switch saves immediately.
        </p>
        {flags.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "var(--color-muted)" }}>Loading flags…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.5rem" }}>
            {flags.map((f) => {
              // Same lockout rule as the manifest: these two keys are how the
              // White Label page stays reachable, so the UI won't switch them off.
              const locked = f.key === "dashboard" || f.key === "shop.manage";
              return (
                <label
                  key={f.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: "0.85rem",
                    padding: "0.4rem 0.5rem",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    opacity: locked ? 0.65 : 1,
                    cursor: saving || locked ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    disabled={saving || locked}
                    onChange={() => toggleFlag(f.key)}
                  />
                  {MODULES.find((m) => m.key === f.key)?.label ?? f.key}
                  <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--color-muted)" }}>
                    {locked ? "required" : f.key}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
