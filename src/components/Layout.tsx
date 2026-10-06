import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isAdminRole } from "../lib/permissions";
import { useConfigMap, useFlagRows, useBranding } from "../lib/useConfigFlags";
import { moduleEnabled, pickFlag } from "../lib/configRules";
import { NotificationBell } from "./NotificationBell";
import ShopSelector from "./ShopSelector";

/**
 * Sidebar entries. `permission` matches a key in src/lib/permissions.ts and is
 * mirrored by the SQL guard in server/index.js. Icons are written as unicode
 * escapes so this file stays plain ASCII. `anyOf` opens an entry to a user who
 * holds any one of several keys — for pages that serve more than one module.
 */
const NAV: { to: string; label: string; icon: string; permission?: string; anyOf?: string[]; adminOnly?: boolean }[] = [
  { to: "/dashboard", label: "Dashboard", icon: "\u25A6", permission: "dashboard" },
  { to: "/reminders", label: "Reminders", icon: "\u23F0", permission: "dashboard" },
  { to: "/pos", label: "New Sale", icon: "\u{1F9FE}", permission: "pos.create" },
  { to: "/sales", label: "Transactions", icon: "\u{1F4DC}", permission: "sales_history" },
  // Field money (collections a phone has taken and not yet handed over) used to
  // have no screen anywhere in the shop. Anyone who can see the dashboard needs
  // to see it, or a collector holding cash is invisible.
  { to: "/field", label: "Field Activity", icon: "\u{1F4F1}", permission: "dashboard" },
  { to: "/reports", label: "Reports", icon: "\u{1F4C8}", permission: "reports" },
  { to: "/profit", label: "Profit & Loss", icon: "\u{1F4B0}", permission: "profit_loss" },
  { to: "/catalog", label: "Catalog", icon: "\u{1F4E6}", permission: "catalog.manage" },
  { to: "/customers", label: "Customers", icon: "\u{1F465}", permission: "customers" },
  { to: "/vendors", label: "Vendors", icon: "\u{1F3EA}", permission: "vendors" },
  { to: "/ledger", label: "Khata", icon: "\u{1F4D8}", anyOf: ["customers", "vendors"] },
  { to: "/accounts", label: "Accounts", icon: "\u{1F4B3}", permission: "accounts" },
  { to: "/expenses", label: "Expenses", icon: "\u{1F4B8}", permission: "expenses.manage" },
  { to: "/purchase", label: "Purchases", icon: "\u{1F69B}", permission: "purchase.manage" },
  { to: "/inspections", label: "Inspections", icon: "\u{1F50D}", permission: "inspections" },
  { to: "/team", label: "Team & Access", icon: "\u{1F464}", permission: "team.manage" },
  { to: "/shop", label: "Shop Settings", icon: "\u2699", permission: "shop.manage" },
  // Owner-level screen: the API only lets admin/owner PATCH config, so gating
  // it on shop.manage would show non-admin managers a page that always 403s.
  { to: "/whitelabel", label: "White Label", icon: "\u{1F3A8}", permission: "shop.manage", adminOnly: true },
];

export default function Layout() {
  const { user, logout, outlets, activeShopId } = useAuth();
  const navigate = useNavigate();
  const admin = isAdminRole(user?.role);
  const perms: string[] = Array.isArray(user?.permissions) ? (user!.permissions as string[]) : [];
  const activeOutlet = outlets.find((o) => o.shop_id === activeShopId) ?? null;
  // One subscription per store for the whole nav — never a hook per entry.
  const cfg = useConfigMap();
  const flags = useFlagRows();
  const branding = useBranding();

  /** Admin/owner see everything; everyone else needs the key on their list. */
  function visible(item: (typeof NAV)[number]) {
    if (item.adminOnly) return admin;
    if (admin) return true;
    const needed = item.anyOf ?? (item.permission ? [item.permission] : []);
    return needed.some((k) => perms.includes(k));
  }

  /**
   * Package + runtime gate: a module the deployment does not include, or one
   * whose feature flag is off, never shows in the nav — whatever the role.
   * Both rules fail open (unreadable manifest, unknown flag), so nav falls
   * back to permission-gating alone instead of vanishing on a config miss.
   */
  function inPackage(item: (typeof NAV)[number]) {
    const needed = item.anyOf ?? (item.permission ? [item.permission] : []);
    if (!needed.length) return true;
    return needed.some(
      (k) => moduleEnabled(cfg["included_modules"], k) && pickFlag(flags, k),
    );
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside
        style={{
          width: 200,
          background: "#0f172a",
          color: "white",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: "1rem",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            fontWeight: 700,
            fontSize: "0.95rem",
            letterSpacing: "0.05em",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div>
            {/* Tenant's name from config, not a hardcoded label: a fixed brand
                above data from whichever tenant/outlet is selected is how a
                white-label deployment stops being one. */}
            {branding.appName}
            {/* The active outlet's real name, not a hardcoded one: a fixed label
                above data from whichever outlet is selected is how a shopkeeper
                reads one outlet's takings while believing they are another's. */}
            <div style={{ fontSize: "0.7rem", fontWeight: 400, color: "#94a3b8", marginTop: 2 }}>
              {activeOutlet?.name ?? "Lubricants"}
            </div>
          </div>
          <NotificationBell />
        </div>

        <ShopSelector />

        <nav style={{ flex: 1, overflow: "auto", padding: "0.5rem 0" }}>
          {NAV.filter(visible).filter(inPackage).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.55rem 1rem",
                color: isActive ? "#60a5fa" : "#94a3b8",
                background: isActive ? "rgba(96,165,250,0.1)" : "transparent",
                textDecoration: "none",
                fontSize: "0.875rem",
                transition: "all 0.15s",
              })}
            >
              <span style={{ fontSize: "1rem", width: 18, textAlign: "center" }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div
          style={{
            padding: "0.75rem 1rem",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            fontSize: "0.8rem",
          }}
        >
          <div style={{ color: "#e2e8f0" }}>{user?.full_name}</div>
          <div style={{ color: "#64748b", fontSize: "0.72rem", textTransform: "capitalize" }}>
            {user?.role}
            {admin ? " · full access" : ` · ${perms.length} permission${perms.length === 1 ? "" : "s"}`}
          </div>
          <button
            onClick={handleLogout}
            style={{
              marginTop: 8,
              width: "100%",
              padding: "0.3rem",
              background: "rgba(255,255,255,0.1)",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              color: "white",
              fontSize: "0.75rem",
            }}
          >
            Logout
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: "auto", background: "#f1f5f9" }}>
        <Outlet />
      </main>
    </div>
  );
}
