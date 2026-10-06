/**
 * React bindings for the config/feature-flag store.
 *
 * One subscription per hook: components re-render when the 30s cache first
 * fills, when a stale entry refetches, or when invalidateConfigCache() fires
 * (admin PATCH, login, logout). Load-on-mount is safe to call repeatedly —
 * ensure* fetches only when the cache is empty or stale.
 *
 * IMPORTANT: call these hooks ONCE per component (usually), never inside a
 * .filter/.map loop — for list gating (nav, tables) read useConfigMap() and
 * call the PURE functions from configRules.ts per row instead.
 */
import { useEffect, useState } from 'react';
import {
  subscribeConfig,
  ensureConfigLoaded,
  ensureFlagsLoaded,
  configMap,
  flagRows,
  type FlagRow,
} from './configFlags';
import { moduleEnabled, pickFlag } from './configRules';

/** Live config map ({} until the first fetch resolves). */
export function useConfigMap(): Record<string, string> {
  const [rows, setRows] = useState<Record<string, string>>(configMap);
  useEffect(() => {
    const refresh = () => setRows(configMap());
    const unsub = subscribeConfig(refresh);
    refresh();
    ensureConfigLoaded();
    return unsub;
  }, []);
  return rows;
}

/** Live feature-flag rows ([] until the first fetch resolves). */
export function useFlagRows(): FlagRow[] {
  const [rows, setRows] = useState<FlagRow[]>(flagRows);
  useEffect(() => {
    const refresh = () => setRows(flagRows());
    const unsub = subscribeConfig(refresh);
    refresh();
    ensureFlagsLoaded();
    return unsub;
  }, []);
  return rows;
}

/** Is a module part of the deployment manifest? Fails open to true. */
export function useHasModule(moduleKey: string): boolean {
  const cfg = useConfigMap();
  return moduleEnabled(cfg['included_modules'], moduleKey);
}

/** Is a feature flag enabled? Fails open to true. */
export function useFeatureFlag(flagKey: string, shopId?: number): boolean {
  const rows = useFlagRows();
  return pickFlag(rows, flagKey, shopId);
}

export interface Branding {
  /** Tenant's display name; the stock label until config loads. */
  appName: string;
  /** Tenant's primary colour ('' when unset/unreadable). */
  primaryColor: string;
}

/** White-label branding for the shell: sidebar title, document title, theme. */
export function useBranding(): Branding {
  const cfg = useConfigMap();
  return {
    appName: (cfg['app_name'] ?? '').trim() || 'LUBRIC POS',
    primaryColor: (cfg['primary_color'] ?? '').trim(),
  };
}
