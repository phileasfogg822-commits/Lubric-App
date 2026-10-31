import { ReactNode, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth, AuthProvider } from "./lib/auth";
import { isAdminRole } from "./lib/permissions";
import { useConfigMap, useFlagRows, useBranding } from "./lib/useConfigFlags";
import { isCapacitor, getLocalDb } from "./lib/db";
import { startSyncLoop } from "./lib/sync";
import { moduleEnabled, pickFlag } from "./lib/configRules";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";

import Login from "./modules/auth/Login";
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
import Inspections from "./modules/inspections/Inspections";
import Purchase from "./modules/purchase/Purchase";
import Team from "./modules/team/Team";
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
 * that serve more than one module (the khata covers customers and vendors).
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
  if (!user) return <Navigate to="/login" replace />;
  if (
    needed.length &&
    !needed.some((k) => moduleEnabled(cfg["included_modules"], k) && pickFlag(flags, k))
  ) {
    return <Navigate to="/dashboard" replace />;
  }
  if (isAdminRole(user.role)) return <>{children}</>;
  if (!user.permissions || !Array.isArray(user.permissions)) return <Navigate to="/dashboard" replace />;
  if (!needed.some((k) => (user.permissions as string[]).includes(k))) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;
  if (user) return <Navigate to="/dashboard" replace />;
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

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Branding />
        <SyncLoop />
        <Routes>
          <Route path="/login" element={<RedirectIfAuth><Login /></RedirectIfAuth>} />

          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reminders" element={<Reminders />} />
            <Route path="/pos" element={<RequirePermission permission="pos.create"><POS /></RequirePermission>} />
            <Route path="/sales" element={<RequirePermission permission="sales_history"><SalesHistory /></RequirePermission>} />
        <Route path="/field" element={<RequirePermission permission="dashboard"><FieldActivity /></RequirePermission>} />
            <Route path="/catalog" element={<RequirePermission permission="catalog.manage"><Catalog /></RequirePermission>} />
            <Route path="/customers" element={<RequirePermission permission="customers"><Customers /></RequirePermission>} />
            <Route path="/vendors" element={<RequirePermission permission="vendors"><Vendors /></RequirePermission>} />
            {/* The khata is per-person: a customer statement and a supplier
                statement are the same screen, so either party's key opens it. */}
            <Route path="/ledger" element={<RequirePermission anyOf={["customers", "vendors"]}><Ledger /></RequirePermission>} />
            <Route path="/accounts" element={<RequirePermission permission="accounts"><Accounts /></RequirePermission>} />
            <Route path="/expenses" element={<RequirePermission permission="expenses.manage"><Expenses /></RequirePermission>} />
            <Route path="/reports" element={<RequirePermission permission="reports"><Reports /></RequirePermission>} />
            <Route path="/profit" element={<RequirePermission permission="profit_loss"><ProfitLoss /></RequirePermission>} />
            <Route path="/purchase" element={<RequirePermission permission="purchase.manage"><Purchase /></RequirePermission>} />
            <Route path="/inspections" element={<RequirePermission permission="inspections"><Inspections /></RequirePermission>} />
            <Route path="/team" element={<RequirePermission permission="team.manage"><Team /></RequirePermission>} />
            <Route path="/shop" element={<RequirePermission permission="shop.manage"><Shop /></RequirePermission>} />
            {/* White-label admin: branding, module manifest, feature flags.
                Gated like shop settings; PATCHes are admin/owner on the API. */}
            <Route path="/whitelabel" element={<RequirePermission permission="shop.manage"><WhiteLabel /></RequirePermission>} />

            {/* Retired pages now folded into others. */}
            <Route path="/settings" element={<Navigate to="/shop" replace />} />
            <Route path="/inventory" element={<Navigate to="/catalog" replace />} />
            <Route path="/users" element={<Navigate to="/team" replace />} />
            <Route path="/products" element={<Navigate to="/catalog" replace />} />
            <Route path="/services" element={<Navigate to="/catalog" replace />} />
            <Route path="/containers" element={<Navigate to="/catalog" replace />} />
            <Route path="/used-oil" element={<Navigate to="/catalog" replace />} />
            <Route path="/vehicles" element={<Navigate to="/customers" replace />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}
