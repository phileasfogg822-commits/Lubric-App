/**
 * Pure rules for config and feature-flag resolution.
 *
 * Deliberately free of imports from the data layer: `db.ts` reads
 * import.meta.env at module scope, which does not exist under plain node, so
 * putting these functions here is what lets unit_config_flags.js test them
 * directly with --experimental-strip-types.
 *
 * Every rule FAILS OPEN. A missing or unparsable manifest means "all modules
 * included", an unknown flag means enabled. The server seeds those defaults
 * (migration 034), so failing open degrades to the full feature set instead
 * of blanking the app when config is unreadable, offline, or mid-deploy.
 */

/** One row of feature_flags as the REST API returns it. */
export interface FlagRow {
  key: string;
  enabled: boolean;
  shop_id: number | null;
}

/**
 * Parse the `included_modules` config value into a module-key list.
 * Returns null when the value is missing or not a usable JSON array — the
 * caller treats null as "everything included".
 */
export function moduleList(raw: string | undefined | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Is `moduleKey` part of the deployment's module manifest?
 * Unreadable manifest → true (fail open), matching the seeded default.
 */
export function moduleEnabled(raw: string | undefined | null, moduleKey: string): boolean {
  const list = moduleList(raw);
  if (!list) return true;
  return list.includes(moduleKey);
}

/**
 * Resolve a flag across its global row and an optional per-outlet override.
 *
 * `shopId` prefers a row owned by that outlet, otherwise the global
 * (shop_id IS NULL) row. The Phase 1 schema allows only one row per key, so
 * the override branch becomes reachable once a composite-key migration lands
 * in a later phase; it is here so callers can pass shopId from day one.
 * Unknown flag or no rows → enabled (fail open, as seeded).
 */
export function pickFlag(rows: FlagRow[], flagKey: string, shopId?: number): boolean {
  const matches = rows.filter((r) => r.key === flagKey);
  if (!matches.length) return true;
  if (shopId != null) {
    const scoped = matches.find((r) => r.shop_id === shopId);
    // Fail open on a malformed row too: only an explicit `false` is off.
    if (scoped) return scoped.enabled !== false;
  }
  const global = matches.find((r) => r.shop_id == null);
  const row = global ?? matches[0];
  return row.enabled !== false;
}