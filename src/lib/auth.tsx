import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { can, isAdminRole, parsePermissions } from "./permissions";

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
const API_BASE = import.meta.env.VITE_API_URL || "/api";

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
        setUser(data.user);
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
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission, permissions, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
