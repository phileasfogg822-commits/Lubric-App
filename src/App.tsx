import { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth, AuthProvider } from "./lib/auth";
import { isAdminRole } from "./lib/permissions";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";

import Login from "./modules/auth/Login";
import Dashboard from "./modules/dashboard/Dashboard";
import POS from "./modules/pos/POS";
import SalesHistory from "./modules/sales/SalesHistory";
import Catalog from "./modules/catalog/Catalog";
import Customers from "./modules/customers/Customers";
import Vendors from "./modules/vendors/Vendors";
import Accounts from "./modules/accounts/Accounts";
import Expenses from "./modules/expenses/Expenses";
import Reports from "./modules/reports/Reports";
import ProfitLoss from "./modules/profit/ProfitLoss";
import Shop from "./modules/shop/Shop";
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
 * Route gate. Admin/owner pass everything; anyone else needs the key in their
 * `users.permissions` list. The API enforces the same keys, so hiding the page
 * is a courtesy — the data is protected server-side too.
 */
function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (isAdminRole(user.role)) return <>{children}</>;
  if (!user.permissions || !Array.isArray(user.permissions)) return <Navigate to="/dashboard" replace />;
  if (!user.permissions.includes(permission)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<RedirectIfAuth><Login /></RedirectIfAuth>} />

          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reminders" element={<Reminders />} />
            <Route path="/pos" element={<RequirePermission permission="pos.create"><POS /></RequirePermission>} />
            <Route path="/sales" element={<RequirePermission permission="sales_history"><SalesHistory /></RequirePermission>} />
            <Route path="/catalog" element={<RequirePermission permission="catalog.manage"><Catalog /></RequirePermission>} />
            <Route path="/customers" element={<RequirePermission permission="customers"><Customers /></RequirePermission>} />
            <Route path="/vendors" element={<RequirePermission permission="vendors"><Vendors /></RequirePermission>} />
            <Route path="/accounts" element={<RequirePermission permission="accounts"><Accounts /></RequirePermission>} />
            <Route path="/expenses" element={<RequirePermission permission="expenses.manage"><Expenses /></RequirePermission>} />
            <Route path="/reports" element={<RequirePermission permission="reports"><Reports /></RequirePermission>} />
            <Route path="/profit" element={<RequirePermission permission="profit_loss"><ProfitLoss /></RequirePermission>} />
            <Route path="/purchase" element={<RequirePermission permission="purchase.manage"><Purchase /></RequirePermission>} />
            <Route path="/inspections" element={<RequirePermission permission="inspections"><Inspections /></RequirePermission>} />
            <Route path="/team" element={<RequirePermission permission="team.manage"><Team /></RequirePermission>} />
            <Route path="/shop" element={<RequirePermission permission="shop.manage"><Shop /></RequirePermission>} />

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
