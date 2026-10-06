/**
 * Central config & feature-flag helpers for the React app.
 *
 * Reads GET /api/config and GET /api/feature-flags with the same runtime API
 * base and Bearer token the SQL client uses (db.ts), so a desktop install
 * pointing at a LAN server asks the same instance as everything else.
 *
 * Every helper FAILS OPEN (via configRules.ts): offline, unseeded, or on any
 * error it returns the defaults migration 034 seeds — all modules included,
 * flag enabled — so a flaky network degrades to the full feature set instead
 * of blanking the nav.
 *
 * Responses are cached in memory for 30s. subscribeConfig() lets React hooks
 * re-render when a cache updates or an admin PATCH invalidates it; the
 * auth layer invalidates on login/logout because the pre-login fetch only
 * sees the branding subset of config and an empty flag set (401).
 */
import { apiBase, authHeaders } from './db';
import { moduleEnabled, pickFlag, type FlagRow } from './configRules';

interface ConfigRow { key: string; value: string; shop_id: number | null; }

export type { FlagRow } from './configRules';

const CACHE_MS = 30_000;

let cachedConfig: ConfigRow[] | null = null;
let configTs = 0;
let cachedFlags: FlagRow[] | null = null;
let flagsTs = 0;

// ── change notification (React re-renders off this) ─────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeConfig(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* listener error must not break the fetch */ }
  }
}

/**
 * Drop both caches and tell every subscriber — the Settings UI calls this
 * after a successful PATCH so the nav and branding update immediately, and
 * auth.tsx calls it on login/logout because the identity behind the caches
 * just changed.
 */
export function invalidateConfigCache(): void {
  cachedConfig = null;
  configTs = 0;
  cachedFlags = null;
  flagsTs = 0;
  notify();
}

// ── fetchers ────────────────────────────────────────────────────────────────

async function fetchRows<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return []; // offline / CORS / desktop with no server reachable
  }
}

/** Fetch config if the cache is empty; subscribers are told when it arrives. */
export async function ensureConfigLoaded(): Promise<void> {
  if (cachedConfig && Date.now() - configTs < CACHE_MS) return;
  const rows = await fetchRows<ConfigRow>('/config');
  // Cache failures too ([]), so a dead server is retried on the next 30s tick
  // rather than once per nav render.
  cachedConfig = rows;
  configTs = Date.now();
  notify();
}

/** Fetch feature flags if the cache is empty; subscribers are told after. */
export async function ensureFlagsLoaded(): Promise<void> {
  if (cachedFlags && Date.now() - flagsTs < CACHE_MS) return;
  const rows = await fetchRows<FlagRow>('/feature-flags');
  cachedFlags = rows;
  flagsTs = Date.now();
  notify();
}

// ── synchronous accessors (for React snapshots) ─────────────────────────────

/** Current config rows as a key→value map; {} before the first fetch. */
export function configMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of cachedConfig ?? []) out[r.key] = r.value;
  return out;
}

// ── public helpers (async; for non-React callers and the Settings UI) ───────

/** Read a single config value; undefined when unset or unreachable. */
export async function getConfig(key: string): Promise<string | undefined> {
  await ensureConfigLoaded();
  return (cachedConfig ?? []).find((r) => r.key === key)?.value;
}

/**
 * Is `moduleKey` in the config's `included_modules` JSON array?
 * Missing or unparsable config means "everything included" — the default
 * migration 034 seeds, so a fresh tenant sees the full suite.
 */
export async function hasModule(moduleKey: string): Promise<boolean> {
  const raw = await getConfig('included_modules');
  return moduleEnabled(raw, moduleKey);
}

/**
 * Is `flagKey` enabled? `shopId` prefers an outlet-specific row when one
 * exists (Phase 1 has one row per key; per-tenant overrides arrive with the
 * composite-key migration of a later phase). Unknown flag ⇒ enabled.
 */
export async function requireFlag(flagKey: string, shopId?: number): Promise<boolean> {
  await ensureFlagsLoaded();
  return pickFlag(cachedFlags ?? [], flagKey, shopId);
}

/** requireFlag against the global row only (no outlet override). */
export async function requireFlagGlobal(flagKey: string): Promise<boolean> {
  return requireFlag(flagKey);
}

/** Current flag rows as returned by the API; [] before the first fetch. */
export function flagRows(): FlagRow[] {
  return cachedFlags ?? [];
}