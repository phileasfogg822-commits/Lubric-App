/**
 * Central config & feature-flag helpers for the React app.
 *
 * Reads GET /api/config and GET /api/feature-flags with the same runtime API
 * base and Bearer token the SQL client uses (db.ts), so a desktop install
 * pointing at a LAN server asks the same instance as everything else.
 *
 * Every helper FAILS OPEN: offline, unseeded, or on any error it returns the
 * defaults migration 034 seeds (all modules included, flag enabled). A gate
 * that throws would blank the nav on a flaky connection; a gate that fails
 * open degrades to the full feature set the tenant had before gating existed.
 *
 * Responses are cached in memory for 30s so nav rendering doesn't refetch per
 * item; call invalidateConfigCache() after an admin PATCH from the Settings UI.
 */
import { apiBase, authHeaders } from './db';

interface ConfigRow { key: string; value: string; shop_id: number | null; }
interface FlagRow { key: string; enabled: boolean; shop_id: number | null; }

const CACHE_MS = 30_000;

let cachedConfig: ConfigRow[] | null = null;
let configTs = 0;
let cachedFlags: FlagRow[] | null = null;
let flagsTs = 0;

/** Drop both caches — the admin Settings UI calls this after a PATCH. */
export function invalidateConfigCache(): void {
  cachedConfig = null;
  configTs = 0;
  cachedFlags = null;
  flagsTs = 0;
}

async function fetchRows<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return []; // offline / CORS / desktop with no server reachable
  }
}

async function configRows(): Promise<ConfigRow[]> {
  if (cachedConfig && Date.now() - configTs < CACHE_MS) return cachedConfig;
  const rows = await fetchRows<ConfigRow>('/config');
  cachedConfig = rows;
  configTs = Date.now();
  return rows;
}

async function flagRows(): Promise<FlagRow[]> {
  if (cachedFlags && Date.now() - flagsTs < CACHE_MS) return cachedFlags;
  const rows = await fetchRows<FlagRow>('/feature-flags');
  cachedFlags = rows;
  flagsTs = Date.now();
  return rows;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Read a single config value; undefined when unset or unreachable. */
export async function getConfig(key: string): Promise<string | undefined> {
  const rows = await configRows();
  return rows.find((r) => r.key === key)?.value;
}

/**
 * Is `moduleKey` listed in the config's `included_modules` JSON array?
 * Missing or unparsable config means "everything included" — the same default
 * migration 034 seeds, so a fresh tenant sees the full suite.
 */
export async function hasModule(moduleKey: string): Promise<boolean> {
  const raw = await getConfig('included_modules');
  if (!raw) return true;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.includes(moduleKey) : true;
  } catch {
    return true;
  }
}

/**
 * Is `flagKey` enabled? `shopId` prefers an outlet-specific row when one
 * exists, otherwise the global (shop_id IS NULL) row. The Phase 1 schema has
 * one row per key, so the shopId branch only becomes reachable once a
 * composite-key migration lands in Phase 2. Unknown flag ⇒ enabled, matching
 * the fail-open default the migration seeds.
 */
export async function requireFlag(flagKey: string, shopId?: number): Promise<boolean> {
  const rows = await flagRows();
  const matches = rows.filter((r) => r.key === flagKey);
  if (!matches.length) return true;
  if (shopId != null) {
    const scoped = matches.find((r) => r.shop_id === shopId);
    if (scoped) return scoped.enabled;
  }
  const global = matches.find((r) => r.shop_id == null);
  return global ? global.enabled : matches[0].enabled;
}

/** requireFlag against the global row only (no outlet override). */
export async function requireFlagGlobal(flagKey: string): Promise<boolean> {
  return requireFlag(flagKey);
}