/**
 * Central permission model.
 *
 * Keys fall into two groups:
 *   - module access : which sidebar pages / read endpoints a user may open
 *   - bill actions  : what a user may do to an existing bill
 *
 * Admin & owner always bypass every check (see `can`). Everyone else is gated
 * by the JSON array stored in `users.permissions`.
 *
 * The server mirrors these keys in `server/index.js` (SQL classifier), so keep
 * the strings here and there in sync.
 */
export const PERMISSIONS = {
  // ── module access ──────────────────────────────────────────────
  DASHBOARD: "dashboard",
  POS_CREATE: "pos.create",
  SALES_HISTORY: "sales_history",
  CATALOG_MANAGE: "catalog.manage",
  CUSTOMERS: "customers",
  VENDORS: "vendors",
  KHATA: "khata",
  ACCOUNTS: "accounts",
  EXPENSES_MANAGE: "expenses.manage",
  PURCHASE_MANAGE: "purchase.manage",
  INSPECTIONS: "inspections",
  REPORTS: "reports",
  PROFIT_LOSS: "profit_loss",
  TEAM_MANAGE: "team.manage",
  SHOP_MANAGE: "shop.manage",

  // ── bill actions ───────────────────────────────────────────────
  BILL_EDIT: "bill.edit",
  BILL_VOID: "bill.void",
  BILL_DELETE: "bill.delete",

  // ── add-only actions ───────────────────────────────────────────
  // A member who may ADD a record without opening the page that lists
  // them: the cashier at the counter records a new customer or an expense
  // but never sees the full list, edits it, or deletes from it.
  CUSTOMER_ADD: "customers.add",
  EXPENSE_ADD: "expenses.add",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDef {
  key: PermissionKey;
  label: string;
  hint?: string;
}

/** Sidebar / page access. */
export const MODULE_PERMISSIONS: PermissionDef[] = [
  { key: PERMISSIONS.DASHBOARD, label: "Dashboard" },
  { key: PERMISSIONS.POS_CREATE, label: "Create Bills (POS)", hint: "Generate new bills" },
  { key: PERMISSIONS.SALES_HISTORY, label: "Sales History", hint: "View bills & transactions" },
  { key: PERMISSIONS.CATALOG_MANAGE, label: "Stock", hint: "Products, services, containers, used oil" },
  { key: PERMISSIONS.CUSTOMERS, label: "Customers" },
  { key: PERMISSIONS.VENDORS, label: "Vendors" },
  { key: PERMISSIONS.KHATA, label: "Khata", hint: "Customer & vendor ledgers" },
  { key: PERMISSIONS.ACCOUNTS, label: "Accounts" },
  { key: PERMISSIONS.EXPENSES_MANAGE, label: "Expenses", hint: "Add & manage expenses" },
  { key: PERMISSIONS.PURCHASE_MANAGE, label: "Purchases" },
  { key: PERMISSIONS.INSPECTIONS, label: "Inspections" },
  { key: PERMISSIONS.REPORTS, label: "Reports" },
  { key: PERMISSIONS.PROFIT_LOSS, label: "Profit & Loss", hint: "P&L statement page" },
  { key: PERMISSIONS.TEAM_MANAGE, label: "Team", hint: "Add members & set their access" },
  { key: PERMISSIONS.SHOP_MANAGE, label: "Shop Settings" },
];

/** Actions on an existing bill — the sensitive half. */
export const ACTION_PERMISSIONS: PermissionDef[] = [
  { key: PERMISSIONS.BILL_EDIT, label: "Edit Bills", hint: "Change items, prices, paid amount" },
  { key: PERMISSIONS.BILL_VOID, label: "Void Bills", hint: "Cancel a bill and reverse stock" },
  { key: PERMISSIONS.BILL_DELETE, label: "Delete Bills", hint: "Permanently remove a voided bill" },
];

/**
 * Add-only actions — the record goes in, but the page that lists, edits
 * and deletes it stays closed. Shown as their own group on the Team page
 * so an admin can tick "may add a customer" without ticking "may open
 * Customers". Not module keys: nothing routes on them.
 */
export const ADD_PERMISSIONS: PermissionDef[] = [
  { key: PERMISSIONS.CUSTOMER_ADD, label: "Add Customers", hint: "Add a customer from the sale screen, without opening the customer list" },
  { key: PERMISSIONS.EXPENSE_ADD, label: "Add Expenses", hint: "Record an expense without seeing the expense records" },
];

export const ALL_PERMISSIONS: PermissionDef[] = [...MODULE_PERMISSIONS, ...ADD_PERMISSIONS, ...ACTION_PERMISSIONS];

/** Roles that bypass every permission check. */
export const ADMIN_ROLES = ["admin", "owner"] as const;

export function isAdminRole(role?: string | null): boolean {
  if (!role) return false;
  return (ADMIN_ROLES as readonly string[]).includes(role.toLowerCase());
}

/**
 * Normalise whatever the database handed us into a string array.
 * Accepts a real array (already parsed) or the raw TEXT column holding JSON.
 * Falls back to a comma list so a hand-edited row cannot break the UI.
 */
export function parsePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch {
      return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export function serializePermissions(keys: string[]): string {
  // De-duplicate and keep a stable order so rows diff cleanly.
  return JSON.stringify(Array.from(new Set(keys)).sort());
}

/** The single source of truth for "may this user do X?". */
export function can(
  user: { role?: string | null; permissions?: unknown } | null | undefined,
  key: string
): boolean {
  if (!user) return false;
  if (isAdminRole(user.role)) return true;
  return parsePermissions(user.permissions).includes(key);
}

/**
 * Sensible starting point when a member is created.
 *
 * NOTE the deliberate omission: cashiers can generate bills and look them up,
 * but they cannot edit, void or delete a bill. That has to be granted by hand.
 */
export function getDefaultPermissions(role: string): string[] {
  const r = (role || "cashier").toLowerCase();

  if (isAdminRole(r)) return ALL_PERMISSIONS.map((p) => p.key);

  if (r === "manager") {
    return ALL_PERMISSIONS.map((p) => p.key).filter(
      (k) =>
        k !== PERMISSIONS.TEAM_MANAGE &&
        k !== PERMISSIONS.SHOP_MANAGE &&
        k !== PERMISSIONS.BILL_DELETE
    );
  }

  // Accountant: the money side — ledgers, accounts, expenses, purchases,
  // reports and P&L — but no till, no team, and no bill changes. The
  // khata is theirs (they chase the money); the customer list stays
  // open for them too, and customers.add rides along for the counter.
  if (r === "accountant") {
    return [
      PERMISSIONS.DASHBOARD,
      PERMISSIONS.SALES_HISTORY,
      PERMISSIONS.CUSTOMERS,
      PERMISSIONS.VENDORS,
      PERMISSIONS.KHATA,
      PERMISSIONS.ACCOUNTS,
      PERMISSIONS.EXPENSES_MANAGE,
      PERMISSIONS.CUSTOMER_ADD,
      PERMISSIONS.PURCHASE_MANAGE,
      PERMISSIONS.REPORTS,
      PERMISSIONS.PROFIT_LOSS,
    ];
  }

  // Worker: counter work only — create bills, look them up, add a
  // customer or an expense from the counter, and run inspections. No
  // money pages, no team, no bill changes, and no customer/expense
  // lists: the records themselves stay with the admin.
  if (r === "worker") {
    return [
      PERMISSIONS.DASHBOARD,
      PERMISSIONS.POS_CREATE,
      PERMISSIONS.SALES_HISTORY,
      PERMISSIONS.CUSTOMER_ADD,
      PERMISSIONS.EXPENSE_ADD,
      PERMISSIONS.INSPECTIONS,
    ];
  }

  // cashier (default) — counter work only: bills, the till, and adding a
  // customer or an expense. The dashboard is on by default; an admin
  // unticks it per member. No khata, no customer list, no expense
  // records: those stay admin-only until explicitly granted.
  return [
    PERMISSIONS.DASHBOARD,
    PERMISSIONS.POS_CREATE,
    PERMISSIONS.SALES_HISTORY,
    PERMISSIONS.CUSTOMER_ADD,
    PERMISSIONS.EXPENSE_ADD,
  ];
}

/**
 * Where a signed-in user lands — and where a denied route bounces them.
 *
 * The old code hardcoded /dashboard everywhere (the `/` route, the `*`
 * route, every RequirePermission denial, the post-login redirect). That
 * is exactly how a cashier with the dashboard unticked still saw the
 * dashboard: the sidebar hid the link, but every redirect landed them
 * on the page itself, which had no gate of its own.
 *
 * The order below is the sidebar order. `enabled` is the deployment /
 * feature-flag check (moduleEnabled + pickFlag); it defaults to "every
 * module enabled" for the pure unit tests, and App.tsx passes the real
 * one — a module the deployment does not include is never a landing
 * spot, or a denied admin would bounce between two closed doors.
 * /version is the last resort: it has no permission gate at all, so the
 * landing can never loop back onto a page that denies the user again.
 */
export interface LandingCandidate {
  to: string;
  keys: string[];
}

export const LANDING_ROUTES: LandingCandidate[] = [
  { to: "/dashboard", keys: [PERMISSIONS.DASHBOARD] },
  { to: "/pos", keys: [PERMISSIONS.POS_CREATE] },
  { to: "/sales", keys: [PERMISSIONS.SALES_HISTORY] },
  { to: "/catalog", keys: [PERMISSIONS.CATALOG_MANAGE] },
  { to: "/customers", keys: [PERMISSIONS.CUSTOMERS] },
  { to: "/vendors", keys: [PERMISSIONS.VENDORS] },
  { to: "/ledger", keys: [PERMISSIONS.KHATA] },
  { to: "/accounts", keys: [PERMISSIONS.ACCOUNTS] },
  { to: "/expenses", keys: [PERMISSIONS.EXPENSES_MANAGE, PERMISSIONS.EXPENSE_ADD] },
  { to: "/purchase", keys: [PERMISSIONS.PURCHASE_MANAGE] },
  { to: "/inspections", keys: [PERMISSIONS.INSPECTIONS] },
  { to: "/reports", keys: [PERMISSIONS.REPORTS] },
  { to: "/profit", keys: [PERMISSIONS.PROFIT_LOSS] },
  { to: "/team", keys: [PERMISSIONS.TEAM_MANAGE] },
  { to: "/shop", keys: [PERMISSIONS.SHOP_MANAGE] },
];

export function firstAllowedRoute(
  user: { role?: string | null; permissions?: unknown } | null | undefined,
  enabled: (key: string) => boolean = () => true
): string {
  if (!user) return "/login";
  if (isAdminRole(user.role)) {
    // Admins skip permission checks but not the deployment manifest: a
    // white-label build without a module must not land on its page.
    for (const c of LANDING_ROUTES) {
      if (c.keys.some((k) => enabled(k))) return c.to;
    }
    return "/version";
  }
  const perms = parsePermissions(user.permissions);
  for (const c of LANDING_ROUTES) {
    if (c.keys.some((k) => perms.includes(k) && enabled(k))) return c.to;
  }
  return "/version";
}
