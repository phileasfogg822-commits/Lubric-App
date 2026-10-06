import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { can, isAdminRole, parsePermissions } from "./permissions";
// Aliased: the context exposes an `activeShopId` VALUE, and importing the
// getter under the same name would shadow it inside the provider.
import { setActiveShopId, activeShopId as readActiveShopId } from "./db";
// Config/flag caches are keyed to WHO is asking (the pre-login fetch only
// sees the branding subset and gets 401 on flags), so they are dropped at
// every identity change.
import { invalidateConfigCache } from "./configFlags";

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
const API_BASE = import.meta.env.VITE_API_URL || "/api";

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
      return JSON.parse(raw) as User;
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
      const res = await fetch(`${API_BASE}/auth/login`, {
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
        setUser(data.user);
        // The outlet list arrives with the login so the selector can render
        // without a second round trip. Default to the home outlet; the effect
        // above reconciles it if a previous session left another one stored.
        const shops: Outlet[] = Array.isArray(data.shops) ? data.shops : [];
        setOutlets(shops);
        if (data.user.shop_id) {
          setActive(data.user.shop_id);
          setActiveShopId(data.user.shop_id);
        }
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
