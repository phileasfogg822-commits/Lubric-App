import { ReactNode, useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useAuth, AuthProvider } from "./lib/auth";
import { isAdminRole, parsePermissions, firstAllowedRoute } from "./lib/permissions";
import { useConfigMap, useFlagRows, useBranding } from "./lib/useConfigFlags";
import { isCapacitor, isTauri, getLocalDb, dbSelect } from "./lib/db";
import { loadTrialState, refreshTrialState } from "./lib/trial";
import type { TrialState } from "./lib/trialCore";
import TrialLock from "./components/TrialLock";
import { startSyncLoop } from "./lib/sync";
import { moduleEnabled, pickFlag } from "./lib/configRules";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";

import Login from "./modules/auth/Login";
import FirstRunSetup from "./modules/auth/FirstRunSetup";
import Dashboard from "./modules/dashboard/Dashboard";
import POS from "./modules/pos/POS";
import SalesHistory from "./modules/sales/SalesHistory";
import FieldActivity from "./modules/field/FieldActivity";
import Catalog from "./modules/catalog/Catalog";
import Customers from "./modules/customers/Customers";
import Vendors from "./modules/vendors/Vendors";
import Ledger from "./modules/ledger/Ledger";
import Accounts from "./modules/accounts/Accounts";
import Expenses from "./modules/expenses/Expenses";
import Reports from "./modules/reports/Reports";
import ProfitLoss from "./modules/profit/ProfitLoss";
import Shop from "./modules/shop/Shop";
import WhiteLabel from "./modules/settings/WhiteLabel";
import Version from "./modules/settings/Version";
import Inspections from "./modules/inspections/Inspections";
import Purchase from "./modules/purchase/Purchase";
import Team from "./modules/team/Team";
import ActivityLog from "./modules/activity/ActivityLog";
import Reminders from "./modules/reminders/Reminders";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Applies tenant branding to the document: the primary colour on the CSS
 * custom property the theme already reads (--color-primary, used by
 * .btn-primary, :focus, and more), and the app name as the tab title.
 * Runs pre-login too — /api/config serves branding keys without a session,
 * so the login screen carries the tenant's identity as well. export.ts
 * temporarily swaps document.title for print filenames and restores it, so
 * it restores TO the tenant name.
 */
function Branding() {
  const { appName, primaryColor } = useBranding();
  useEffect(() => {
    if (primaryColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(primaryColor)) {
      document.documentElement.style.setProperty("--color-primary", primaryColor);
    }
    document.title = appName;
  }, [appName, primaryColor]);
  return null;
}

/**
 * Route gate. Admin/owner pass every permission check; anyone else needs the
 * key in their `users.permissions` list. The API enforces the same keys, so
 * hiding the page is a courtesy — the data is protected server-side too.
 *
 * The deployment manifest (included_modules) and the feature flag for the
 * page gate EVERYONE, admin included: a package without the module — or one
 * that has it switched off at runtime — doesn't render its page for any
 * role. Both are checked first and fail open when unreadable, so a transient
 * config miss degrades to permission-gating rather than locking admins out
 * of their own pages.
 *
 * `permission` gates on a single key; `anyOf` on any one of several, for pages
 * that serve more than one module (expenses: the manage key or the add-only
 * key both open the page; the page itself splits what each may see).
 *
 * A denial never points at /dashboard any more: a user without the
 * dashboard key would bounce straight back onto a page that denies them
 * again. It points at their first allowed page instead (see
 * firstAllowedRoute in permissions.ts) — /version when they hold nothing.
 */
function RequirePermission({
  permission,
  anyOf,
  children,
}: {
  permission?: string;
  anyOf?: string[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  const cfg = useConfigMap();
  const flags = useFlagRows();
  const needed = anyOf ?? (permission ? [permission] : []);
  // The deployment / flag check, as a predicate the landing helper reuses:
  // a denied user must land on a page their package actually includes.
  const enabled = (k: string) => moduleEnabled(cfg["included_modules"], k) && pickFlag(flags, k);
  if (!user) return <Navigate to="/login" replace />;
  if (
    needed.length &&
    !needed.some((k) => enabled(k))
  ) {
    return <Navigate to={firstAllowedRoute(user, enabled)} replace />;
  }
  if (isAdminRole(user.role)) return <>{children}</>;
  // users.permissions is a TEXT column holding a JSON string, so the raw
  // value is never an array — parse it, or every protected route bounces
  // a non-admin back to /dashboard (the old Array.isArray check failed).
  const perms = parsePermissions(user.permissions);
  if (!needed.some((k) => perms.includes(k))) {
    return <Navigate to={firstAllowedRoute(user, enabled)} replace />;
  }
  return <>{children}</>;
}

/**
 * Admin-only gate. team.manage is NOT enough: the activity log shows
 * every member's actions, and Umar wants it visible to the admin account
 * only. A non-admin lands on their first allowed page, never on a page
 * that would deny them again.
 */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const cfg = useConfigMap();
  const flags = useFlagRows();
  const enabled = (k: string) => moduleEnabled(cfg["included_modules"], k) && pickFlag(flags, k);
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdminRole(user.role)) return <Navigate to={firstAllowedRoute(user, enabled)} replace />;
  return <>{children}</>;
}

/** `/` and `*`: land on the first page this user may actually open. */
function LandingRedirect() {
  const { user } = useAuth();
  const cfg = useConfigMap();
  const flags = useFlagRows();
  const enabled = (k: string) => moduleEnabled(cfg["included_modules"], k) && pickFlag(flags, k);
  return <Navigate to={firstAllowedRoute(user, enabled)} replace />;
}

function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const cfg = useConfigMap();
  const flags = useFlagRows();
  const enabled = (k: string) => moduleEnabled(cfg["included_modules"], k) && pickFlag(flags, k);
  if (loading) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;
  if (user) return <Navigate to={firstAllowedRoute(user, enabled)} replace />;
  return <>{children}</>;
}

/**
 * Windows standalone (Tauri) first-run gate. A fresh install has an empty
 * users table — nobody can sign in yet — so the login page sends the visitor
 * to /setup instead. Web and server builds skip this entirely; if the local
 * schema cannot be read yet the login page renders as normal and the setup
 * screen itself re-checks.
 */
function FirstRunGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isTauri()) {
        try {
          const rows = await dbSelect<{ c: number }>("SELECT COUNT(*) AS c FROM users");
          if (!cancelled && rows[0] && Number(rows[0].c) === 0) {
            navigate("/setup", { replace: true });
          }
        } catch {
          // Schema not ready — fall through to the login page.
        }
      }
      if (!cancelled) setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  if (!checked) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;
  return <>{children}</>;
}

/**
 * Phase 3.2: the phone's background sync. Starts once at app launch when
 * running in Capacitor; the loop itself no-ops each tick until a cloud URL
 * and a device token exist, so pairing later (Shop Settings) picks it up
 * with no restart. Web and Tauri builds never start it — their sync stays
 * manual, exactly as before.
 */
function SyncLoop() {
  useEffect(() => {
    if (!isCapacitor()) return;
    let cancelled = false;
    getLocalDb()
      .then((db) => { if (!cancelled) startSyncLoop(() => Promise.resolve(db)); })
      .catch(() => { /* the sync status UI reports; a failed open retries on next launch */ });
    return () => { cancelled = true; };
  }, []);
  return null;
}

/**
 * Batch 16 (2026-11-28): the trial gate. Windows standalone only — the
 * trial module returns "inactive" everywhere else, so the VPS web app,
 * the ?demo=1 auto-login and the portfolio demo links never see it.
 *
 * On a Tauri launch the trial clock is read once (first launch starts the
 * 7-day clock; the date lives outside the database so a reinstall cannot
 * restart it). An expired or tampered install shows ONLY the lock screen
 * — no login, no setup, no routes — until a valid activation code lands.
 * The lock never deletes data; it only hides the app.
 */
function TrialGate({ children }: { children: ReactNode }) {
  const [trial, setTrial] = useState<TrialState | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadTrialState()
      .then((s) => {
        if (!cancelled) setTrial(s);
      })
      .catch(() => {
        // Trial unreadable — fail open to the login screen rather than
        // bricking the till; the gate re-checks on the next launch.
        if (!cancelled) {
          setTrial({
            status: "inactive",
            firstDate: null,
            expiryDate: null,
            daysLeft: 0,
            tampered: false,
            unlocked: false,
            used: [],
            lastSeen: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!trial) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;
  if (trial.status === "expired" || trial.status === "tampered") {
    return (
      <TrialLock
        initial={trial}
        onActivated={() => {
          refreshTrialState().then(setTrial).catch(() => undefined);
        }}
      />
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Branding />
        <SyncLoop />
        <TrialGate>
        <Routes>
          <Route path="/login" element={<FirstRunGate><RedirectIfAuth><Login /></RedirectIfAuth></FirstRunGate>} />
          <Route path="/setup" element={<FirstRunSetup />} />

          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route path="/" element={<LandingRedirect />} />

            {/* The dashboard used to sit outside any gate, so unticking it
                for a member hid the sidebar link but left the page itself
                open — every redirect in the app landed them on it. It is
                gated like every other module now. */}
            <Route path="/dashboard" element={<RequirePermission permission="dashboard"><Dashboard /></RequirePermission>} />
            <Route path="/reminders" element={<RequirePermission permission="dashboard"><Reminders /></RequirePermission>} />
            <Route path="/pos" element={<RequirePermission permission="pos.create"><POS /></RequirePermission>} />
            <Route path="/sales" element={<RequirePermission permission="sales_history"><SalesHistory /></RequirePermission>} />
        <Route path="/field" element={<RequirePermission permission="dashboard"><FieldActivity /></RequirePermission>} />
            <Route path="/catalog" element={<RequirePermission permission="catalog.manage"><Catalog /></RequirePermission>} />
            <Route path="/customers" element={<RequirePermission permission="customers"><Customers /></RequirePermission>} />
            <Route path="/vendors" element={<RequirePermission permission="vendors"><Vendors /></RequirePermission>} />
            {/* The khata is its own module now: it used to open on either
                party key, so it could never be switched off per member. */}
            <Route path="/ledger" element={<RequirePermission permission="khata"><Ledger /></RequirePermission>} />
            <Route path="/accounts" element={<RequirePermission permission="accounts"><Accounts /></RequirePermission>} />
            {/* Either key opens the page: expenses.manage sees everything,
                expenses.add sees the form only — the page splits the rest. */}
            <Route path="/expenses" element={<RequirePermission anyOf={["expenses.manage", "expenses.add"]}><Expenses /></RequirePermission>} />
            <Route path="/reports" element={<RequirePermission permission="reports"><Reports /></RequirePermission>} />
            <Route path="/profit" element={<RequirePermission permission="profit_loss"><ProfitLoss /></RequirePermission>} />
            <Route path="/purchase" element={<RequirePermission permission="purchase.manage"><Purchase /></RequirePermission>} />
            <Route path="/inspections" element={<RequirePermission permission="inspections"><Inspections /></RequirePermission>} />
            <Route path="/team" element={<RequirePermission permission="team.manage"><Team /></RequirePermission>} />
            {/* Admin-only: team.manage is not enough — the log shows every
                member's actions, and only the admin account may read it. */}
            <Route path="/activity" element={<RequireAdmin><ActivityLog /></RequireAdmin>} />
            <Route path="/shop" element={<RequirePermission permission="shop.manage"><Shop /></RequirePermission>} />
            {/* White-label admin: branding, module manifest, feature flags.
                Gated like shop settings; PATCHes are admin/owner on the API. */}
            <Route path="/whitelabel" element={<RequirePermission permission="shop.manage"><WhiteLabel /></RequirePermission>} />
            {/* No permission gate: every signed-in user must be able to read
                which build is installed when reporting a bug. */}
            <Route path="/version" element={<Version />} />

            {/* Retired pages now folded into others. */}
            <Route path="/settings" element={<Navigate to="/shop" replace />} />
            <Route path="/inventory" element={<Navigate to="/catalog" replace />} />
            <Route path="/users" element={<Navigate to="/team" replace />} />
            <Route path="/products" element={<Navigate to="/catalog" replace />} />
            <Route path="/services" element={<Navigate to="/catalog" replace />} />
            <Route path="/containers" element={<Navigate to="/catalog" replace />} />
            <Route path="/used-oil" element={<Navigate to="/catalog" replace />} />
            <Route path="/vehicles" element={<Navigate to="/customers" replace />} />

            <Route path="*" element={<LandingRedirect />} />
          </Route>
        </Routes>
        </TrialGate>
      </ErrorBoundary>
    </AuthProvider>
  );
}
