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
  { key: PERMISSIONS.CATALOG_MANAGE, label: "Catalog", hint: "Products, services, containers, used oil" },
  { key: PERMISSIONS.CUSTOMERS, label: "Customers" },
  { key: PERMISSIONS.VENDORS, label: "Vendors" },
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

export const ALL_PERMISSIONS: PermissionDef[] = [...MODULE_PERMISSIONS, ...ACTION_PERMISSIONS];

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

  // cashier (default)
  return [
    PERMISSIONS.DASHBOARD,
    PERMISSIONS.POS_CREATE,
    PERMISSIONS.SALES_HISTORY,
    PERMISSIONS.CUSTOMERS,
  ];
}
