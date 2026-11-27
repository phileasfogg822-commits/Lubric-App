import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import bcrypt from "bcryptjs";
import { can, isAdminRole, parsePermissions } from "./permissions";
// Aliased: the context exposes an `activeShopId` VALUE, and importing the
// getter under the same name would shadow it inside the provider.
import { setActiveShopId, activeShopId as readActiveShopId, apiBase, dbGet, isTauri } from "./db";
// Config/flag caches are keyed to WHO is asking (the pre-login fetch only
// sees the branding subset and gets 401 on flags), so they are dropped at
// every identity change.
import { invalidateConfigCache } from "./configFlags";
// Passwords are never stored: the persisted user row carries no hash, and a
// successful sign-in remembers only the email, for the login picker.
import { rememberEmail, stripPasswordHash } from "./loginMemory";
import { logAction } from "./activityLog";

export interface User {
  id: number;
  shop_id: number;
  email: string;
  password_hash: string;
  full_name: string;
  role: "admin" | "cashier" | "owner" | "manager";
  /** JSON array (or already-parsed array) of permission keys. Admin/owner bypass. */
  permissions?: string[] | string;
  created_at: string;
}

const STORAGE_KEY = "lubric_user";
const TOKEN_KEY = "lubric_token";
const SHOPS_KEY = "lubric_shops";

/** An outlet this login may enter. Returned by /api/auth/login. */
export interface Outlet {
  shop_id: number;
  role: string | null;
  name: string;
  address: string | null;
  phone: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  hasPermission: (key: string) => boolean;
  /** Parsed permission keys for the signed-in user (admin/owner bypass, list stays empty). */
  permissions: string[];
  /** True for admin/owner — they skip every permission check. */
  isAdmin: boolean;
  /** Every outlet this login may enter. Empty until login resolves. */
  outlets: Outlet[];
  /** The outlet currently being worked in. Falls back to the user's home outlet. */
  activeShopId: number | null;
  /** Switch outlet. Persisted and sent as X-Shop-Id on every request. */
  switchOutlet: (shopId: number) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      // A session stored before this fix may still carry password_hash;
      // strip it on load, and the persist effect below writes back clean.
      return stripPasswordHash(JSON.parse(raw) as User);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  // Outlets this login may enter, and which one is active. Both persisted, so
  // a refresh does not silently drop the shopkeeper back into their home outlet
  // while every cached total on screen still says otherwise.
  const [outlets, setOutlets] = useState<Outlet[]>(() => {
    try {
      const raw = localStorage.getItem(SHOPS_KEY);
      return raw ? (JSON.parse(raw) as Outlet[]) : [];
    } catch {
      return [];
    }
  });
  const [activeShopId, setActive] = useState<number | null>(() => {
    const stored = readActiveShopId();
    if (stored && /^\d+$/.test(stored)) return Number(stored);
    return null;
  });

  useEffect(() => {
    try {
      if (outlets.length) localStorage.setItem(SHOPS_KEY, JSON.stringify(outlets));
      else localStorage.removeItem(SHOPS_KEY);
    } catch { /* private mode */ }
  }, [outlets]);

  // The home outlet wins whenever nothing valid is stored, and the stored
  // choice is dropped if it is not one the login may actually enter - so a
  // revoked membership cannot linger in localStorage and keep sending a header
  // the server will ignore anyway.
  useEffect(() => {
    if (!user) return;
    const allowed = outlets.map((o) => o.shop_id);
    if (!activeShopId || (allowed.length && !allowed.includes(activeShopId))) {
      const home = user.shop_id ?? null;
      setActive(home);
      if (home) setActiveShopId(home);
    }
  }, [user, outlets, activeShopId]);

  function switchOutlet(shopId: number) {
    setActive(shopId);
    setActiveShopId(shopId);
  }

  // Persist to localStorage on change
  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [user]);

  async function login(email: string, password: string): Promise<boolean> {
    setLoading(true);
    try {
      // Windows standalone (Tauri): there is no server to ask, so the
      // password is verified against the LOCAL users table instead.
      if (isTauri()) return await loginLocal(email, password);
      const res = await fetch(`${apiBase()}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.user && data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
        // The branding-only, flag-less caches from the pre-login screen must
        // not survive into the session: refetch as this user.
        invalidateConfigCache();
        // Store the user WITHOUT password_hash, and remember only the email
        // for the login picker — the password itself is never persisted.
        setUser(stripPasswordHash<User>(data.user));
        rememberEmail(email);
        // The outlet list arrives with the login so the selector can render
        // without a second round trip. Default to the home outlet; the effect
        // above reconciles it if a previous session left another one stored.
        const shops: Outlet[] = Array.isArray(data.shops) ? data.shops : [];
        setOutlets(shops);
        if (data.user.shop_id) {
          setActive(data.user.shop_id);
          setActiveShopId(data.user.shop_id);
        }
        // Sign-ins are audited: the Activity page shows who signed in and
        // when. Best-effort — logAction never throws, so a logging failure
        // cannot fail the sign-in it was recording.
        void logAction(stripPasswordHash<User>(data.user), "login", "user", data.user.id, `Signed in as ${data.user.email}`);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Login error:", err);
      return false;
    } finally {
      setLoading(false);
    }
  }

  /**
   * Windows standalone login: verify the password against the local SQLite
   * users table (bcryptjs) and sign in against the single local shop.
   * The session marker is the literal string "local" — there is no JWT when
   * there is no server. Server-mode login is untouched by this path.
   */
  async function loginLocal(email: string, password: string): Promise<boolean> {
    const row = await dbGet<User>(
      "SELECT id, shop_id, email, password_hash, full_name, role, permissions, created_at FROM users WHERE LOWER(email) = LOWER($1)",
      [email.trim()]
    );
    if (!row || !row.password_hash) return false;
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return false;
    localStorage.setItem(TOKEN_KEY, "local");
    // Same cache discipline as the server path: the pre-login branding
    // cache must not survive into the session.
    invalidateConfigCache();
    // The database row carries password_hash for the bcrypt check above;
    // the session copy must not. Remember only the email for the picker.
    setUser(stripPasswordHash(row));
    rememberEmail(email);
    // One shop, one outlet: the local database holds exactly the shop this
    // install was set up for.
    const shop = await dbGet<{ id: number; name: string }>(
      "SELECT id, name FROM shops WHERE id = $1",
      [row.shop_id ?? 1]
    );
    const outlet: Outlet = {
      shop_id: shop?.id ?? row.shop_id ?? 1,
      role: row.role,
      name: shop?.name ?? "Shop",
      address: null,
      phone: null,
    };
    setOutlets([outlet]);
    setActive(outlet.shop_id);
    setActiveShopId(outlet.shop_id);
    void logAction(stripPasswordHash(row), "login", "user", row.id, `Signed in as ${row.email}`);
    return true;
  }

  function logout() {
    setUser(null);
    // Next login may be a different role with a different module manifest.
    invalidateConfigCache();
    // The outlet choice is cleared with the session: it is part of being
    // signed in, and leaving it behind would let the next person in start in
    // the previous person's outlet.
    setOutlets([]);
    setActive(null);
    try {
      localStorage.removeItem(SHOPS_KEY);
      localStorage.removeItem("lubric_active_shop");
    } catch { /* private mode */ }
  }

  /**
   * Real permission check — reads the `permissions` list the API returns with
   * the user row. Admin & owner bypass every key.
   */
  function hasPermission(key: string): boolean {
    return can(user, key);
  }

  const permissions = parsePermissions(user?.permissions);
  const isAdmin = isAdminRole(user?.role);

  return (
    <AuthContext.Provider
      value={{
        user, loading, login, logout, hasPermission, permissions, isAdmin,
        outlets, activeShopId, switchOutlet,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
