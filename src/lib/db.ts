import { pgToSqlite, ensureLocalSchema } from "./localDb";

const DEFAULT_API_BASE = import.meta.env.VITE_API_URL || '/api';

// In development, Vite proxies /api to the backend.
// In production, set VITE_API_URL to the full backend URL.

/**
 * Dual-mode data layer.
 *
 *  - "server"  — the current thin SQL client over HTTP (shop LAN server / VPS).
 *  - "local"   — SQLite inside the Tauri desktop app (offline-first).
 *
 * Mode resolution order: explicit localStorage override → Tauri detection.
 * In server mode, if a request fails because the server is unreachable, the
 * driver can fall back to local (opt-in via localStorage "lubric_fallback_local").
 */

type DbMode = "server" | "local";

let cachedMode: DbMode | null = null;
let localConn: any = null;
let modeListeners: ((m: DbMode) => void)[] = [];

/** React-friendly: subscribe to mode changes (used by the sync status UI). */
export function onModeChange(fn: (m: DbMode) => void): () => void {
  modeListeners.push(fn);
  return () => { modeListeners = modeListeners.filter((f) => f !== fn); };
}

function notifyMode(m: DbMode) {
  for (const fn of modeListeners) { try { fn(m); } catch { /* listener error */ } }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as any);
}

export function getDbMode(): DbMode | null {
  return cachedMode;
}

export function setDbMode(mode: DbMode): void {
  cachedMode = mode;
  try { localStorage.setItem("lubric_db_mode", mode); } catch { /* private mode */ }
  notifyMode(mode);
}

async function resolveMode(): Promise<DbMode> {
  if (cachedMode) return cachedMode;
  let stored: string | null = null;
  try { stored = localStorage.getItem("lubric_db_mode"); } catch { /* ignore */ }
  cachedMode = stored === "local" || stored === "server" ? stored : (isTauri() ? "local" : "server");
  return cachedMode;
}

export async function getLocalDb(): Promise<any> {
  return getLocal();
}

async function getLocal(): Promise<any> {
  if (!localConn) {
    const mod: any = await import("@tauri-apps/plugin-sql");
    const load = mod.load ?? mod.default?.load;
    localConn = await load("sqlite:lubric.db");
  }
  await ensureLocalSchema(localConn);
  return localConn;
}

function apiBase(): string {
  try {
    const override = localStorage.getItem("lubric_api_url");
    return override || DEFAULT_API_BASE;
  } catch { return DEFAULT_API_BASE; }
}

// ── active outlet ───────────────────────────────────────────────────────────
// One login can reach several outlets now, so the browser must say which one it
// is working in on every request. Sent as X-Shop-Id and validated server-side
// against user_shops before it is trusted - see resolveShop() in server/index.js.
//
// Stored in localStorage, not memory, so a refresh does not silently drop you
// back into the home outlet while cached totals still say otherwise. The
// selector also stamps it on change, so the label and the data cannot drift.
export const ACTIVE_SHOP_KEY = 'lubric_active_shop';

export function activeShopId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SHOP_KEY);
  } catch {
    return null;
  }
}

export function setActiveShopId(id: number | string): void {
  try {
    localStorage.setItem(ACTIVE_SHOP_KEY, String(id));
  } catch {
    /* private mode - the server falls back to the home outlet */
  }
}

/**
 * The backend's permission guard requires a Bearer token on every call, and
 * the outlet must ride along with it so row security can apply.
 */
function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem('lubric_token');
    const shop = localStorage.getItem(ACTIVE_SHOP_KEY);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (shop) headers['X-Shop-Id'] = shop;
    return headers;
  } catch {
    return {};
  }
}

export async function dbSelect<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (await resolveMode() === "local") {
    const db: any = await getLocal();
    return db.select(pgToSqlite(sql), params) as Promise<T[]>;
  }
  const res = await fetch(`${apiBase()}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Query failed');
  }
  return res.json();
}

export async function dbExecute(sql: string, params: unknown[] = []): Promise<{ rowCount: number; rows: unknown[] }> {
  if (await resolveMode() === "local") {
    const db: any = await getLocal();
    // RETURNING rows are fetched via select(); the plugin's execute() only
    // reports affected-row counts.
    if (/\breturning\b/i.test(sql)) {
      const rows = await db.select(pgToSqlite(sql), params);
      return { rowCount: rows.length, rows };
    }
    const r = await db.execute(pgToSqlite(sql), params);
    return { rowCount: r.rowsAffected ?? 0, rows: [] };
  }
  const res = await fetch(`${apiBase()}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Execute failed');
  }
  return res.json();
}

export async function dbGet<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await dbSelect<T>(sql, params);
  return rows[0] ?? null;
}

// Run multiple statements in a transaction
export async function dbTransaction(
  statements: { sql: string; params?: unknown[] }[]
): Promise<{ rowCount: number; rows: any[] }[]> {
  if (await resolveMode() === "local") {
    const db: any = await getLocal();
    const results: { rowCount: number; rows: any[] }[] = [];
    await db.execute("BEGIN");
    try {
      for (const st of statements) {
        const p = st.params ?? [];
        if (/\breturning\b/i.test(st.sql)) {
          const rows = await db.select(pgToSqlite(st.sql), p);
          results.push({ rowCount: rows.length, rows });
        } else {
          const r = await db.execute(pgToSqlite(st.sql), p);
          results.push({ rowCount: r.rowsAffected ?? 0, rows: [] });
        }
      }
      await db.execute("COMMIT");
    } catch (e) {
      try { await db.execute("ROLLBACK"); } catch { /* already rolled back */ }
      throw e;
    }
    return results;
  }
  const res = await fetch(`${apiBase()}/transaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ statements }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Transaction failed');
  }
  const data = await res.json();
  return data.results ?? [];
}

