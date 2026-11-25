import { pgToSqlite, ensureLocalSchema } from "./localDb";
import { injectUuid } from "./outbox";
import { SYNC_TABLES } from "./sync";

const DEFAULT_API_BASE = import.meta.env.VITE_API_URL
  // The baked URL is the web origin (e.g. http://host:9001); the API lives
  // under /api on it. Appending it here — and NOT in the workflow — keeps
  // one rule for every caller, and keeps cloud.ts's origin (sync adds its
  // own /api/v1/...) correct. Without this suffix the APK called
  // {origin}/auth/login and {origin}/query, which the web container
  // answers 405 — so no APK build could ever sign in (found 2026-10-31).
  ? import.meta.env.VITE_API_URL.replace(/\/+$/, "") + "/api"
  : '/api';

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

/**
 * True inside a Capacitor WebView (the phone shell). The Capacitor runtime
 * injects window.Capacitor; a plain browser tab has none, so this never fires
 * for the web/desktop build. Checked without importing @capacitor/core, so
 * the web bundle is untouched by this branch.
 */
export function isCapacitor(): boolean {
  try {
    const c = (window as any)?.Capacitor;
    return typeof window !== "undefined" && !!c && typeof c.isNativePlatform === "function" && c.isNativePlatform();
  } catch {
    return false;
  }
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
  cachedMode = stored === "local" || stored === "server" ? stored : (isCapacitor() ? "local" : (isTauri() ? "local" : "server"));
  return cachedMode;
}

export async function getLocalDb(): Promise<any> {
  return getLocal();
}

/** How long a local write waits for the database lock before failing (ms).
 *
 * The driver is sqlx-sqlite through @tauri-apps/plugin-sql, not rusqlite:
 * the plugin opens the database as a pool, and the batch-4 timeout used to
 * be set on only the ONE connection getLocal's load happened to use — the
 * pool connections opened later kept the default and failed instantly with
 * SQLITE_BUSY (517). After the batch-6 single-connection swap (see
 * getLocal, and src-tauri/src/db_pool.rs) the loaded connection IS the
 * only connection, so the timeout set here covers every local write. Five
 * seconds covers a sale transaction and a sync pass; the sync loop runs
 * every 2 minutes and a sale takes far less than that. Set on the
 * connection before the schema DDL, so the schema work benefits too.
 * Runs through the unified handle's execute, so it covers both the Tauri
 * and the Capacitor drivers. */
export const LOCAL_BUSY_TIMEOUT_MS = 5000;

// ── local operation serialisation ────────────────────────────────────────
// The local SQLite driver is @tauri-apps/plugin-sql (sqlx, NOT rusqlite):
// it opens the database as a pool of up to ten connections and runs every
// execute/select as a fresh acquire from it, with no transaction primitive
// of its own. Two things follow, and this chain is the JS half of both:
//
//  1. Two transactions must never interleave: on the single-connection pool
//     (see use_single_connection_pool, Rust) a second BEGIN landing while
//     the first transaction is open is "cannot start a transaction within
//     a transaction" — and on the plugin's own pool it splits the
//     transaction across connections. Every local operation — reads,
//     single writes, whole transactions — runs through this one FIFO chain,
//     in the order it was called, so a transaction's BEGIN..COMMIT is never
//     interrupted by another operation.
//  2. The chain never breaks: a rejected operation still hands the next one
//     a settled promise, so one failed sale cannot wedge every later
//     database call behind it.
//
// The chain wraps the local path only (server mode is HTTP, one request at
// a time already). Nothing inside a chained callback calls dbSelect /
// dbExecute / dbTransaction again — they all use the raw connection
// handle — so the chain cannot deadlock on itself.
let localQueue: Promise<void> = Promise.resolve();
/** Run `fn` after every earlier local operation has settled. */
function runLocalSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = localQueue.then(fn);
  localQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

let localConnPromise: Promise<any> | null = null;

async function getLocal(): Promise<any> {
  if (!localConnPromise) {
    // Promise-cached, not assigned after the await: concurrent callers used
    // to all see localConn === null and each open their own connection, so
    // one process held several writers on the same file — the 517 race in
    // its purest form. The cached promise hands every caller the one load.
    // A failed load clears the cache before rethrowing, so the next call
    // retries instead of awaiting a permanently rejected promise.
    localConnPromise = (async () => {
      try {
        let conn: any;
        if (isCapacitor()) {
          // Phone shell: the Capacitor SQLite driver (see capDb.ts). The Tauri
          // plugin does not exist in a WebView, so this branch must come first.
          const cap: any = await import("./capDb");
          conn = await cap.openCapDb();
        } else {
          const mod: any = await import("@tauri-apps/plugin-sql");
          const load = mod.load ?? mod.default?.load;
          conn = await load("sqlite:lubric.db");
          // Batch 6 (2026-11-25): the plugin opens the database as a pool
          // of up to ten sqlx connections, and a BEGIN..COMMIT driven from
          // JS can split across them — a failed sale then leaves its
          // earlier writes committed (stock down, no order). Swap the pool
          // for one connection, right after load and before any statement,
          // so every statement of a transaction runs on the same
          // connection (see src-tauri/src/db_pool.rs). Non-fatal by
          // design: if the swap cannot run (a capability or plugin
          // change), the app keeps working on the plugin's pool — the FIFO
          // chain above still serialises operations — and the failure is
          // loud in the console rather than a bricked till.
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("use_single_connection_pool", { db: "sqlite:lubric.db" });
          } catch (e) {
            console.error("[lubric] single-connection pool swap failed — sales stay on the plugin pool:", e);
          }
        }
        await conn.execute(`PRAGMA busy_timeout = ${LOCAL_BUSY_TIMEOUT_MS}`);
        await ensureLocalSchema(conn);
        return conn;
      } catch (e) {
        localConnPromise = null;
        throw e;
      }
    })();
  }
  return localConnPromise;
}

export function apiBase(): string {
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
export function authHeaders(): Record<string, string> {
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
    return runLocalSerialized(async () => {
      const db: any = await getLocal();
      return db.select(pgToSqlite(sql), params) as Promise<T[]>;
    });
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
    return runLocalSerialized(async () => {
      const db: any = await getLocal();
      // A local INSERT into a replicated table needs a uuid, or the outbox
      // trigger skips it and the row never syncs. Injected before the
      // Postgres→SQLite translation; injectUuid appends the uuid as a
      // numbered placeholder ($K, K past the highest $N) — a bare `?` would
      // bind the FIRST value under sqlx, not the uuid (see outbox.ts).
      const inj = injectUuid(sql, params, SYNC_TABLES);
      const finalSql = inj ? inj.sql : sql;
      const finalParams = inj ? inj.params : params;
      // RETURNING rows are fetched via select(); the plugin's execute() only
      // reports affected-row counts.
      if (/\breturning\b/i.test(finalSql)) {
        const rows = await db.select(pgToSqlite(finalSql), finalParams);
        return { rowCount: rows.length, rows };
      }
      const r = await db.execute(pgToSqlite(finalSql), finalParams);
      return { rowCount: r.rowsAffected ?? 0, rows: [] };
    });
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
    // The whole BEGIN..COMMIT holds the FIFO chain: no other local
    // operation can land between its statements — on the single-connection
    // pool that is what keeps the transaction on one connection, and
    // without it a second BEGIN would be "cannot start a transaction
    // within a transaction".
    return runLocalSerialized(async () => {
      const db: any = await getLocal();
      const results: { rowCount: number; rows: any[] }[] = [];
      await db.execute("BEGIN");
      try {
        for (const st of statements) {
          const p = st.params ?? [];
          const inj = injectUuid(st.sql, p, SYNC_TABLES);
          const s = inj ? inj.sql : st.sql;
          const pp = inj ? inj.params : p;
          if (/\breturning\b/i.test(s)) {
            const rows = await db.select(pgToSqlite(s), pp);
            results.push({ rowCount: rows.length, rows });
          } else {
            const r = await db.execute(pgToSqlite(s), pp);
            results.push({ rowCount: r.rowsAffected ?? 0, rows: [] });
          }
        }
        await db.execute("COMMIT");
      } catch (e) {
        try { await db.execute("ROLLBACK"); } catch { /* already rolled back */ }
        throw e;
      }
      return results;
    });
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

