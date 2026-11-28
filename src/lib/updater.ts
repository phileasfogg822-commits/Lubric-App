/**
 * Batch 17 (2026-11-28): in-app updater feed — PURE module (no imports).
 *
 * The updater feed is the `latest.json` CI publishes to GitHub Releases
 * (see .github/workflows/windows-app.yml, "Publish updater release").
 * This module parses that feed and compares versions with the same rules
 * the Tauri updater plugin applies: the feed version must be a valid
 * semver strictly newer than the installed version, or there is no update.
 *
 * Import-free on purpose, so the sims can load it in plain Node. The
 * plugin calls (check/download/install/relaunch) live in updaterClient.ts.
 */

/** Stable URL of the updater feed (rolling `windows-latest` release). */
export const UPDATER_FEED_URL =
  "https://github.com/phileasfogg822-commits/Lubric-App/releases/download/windows-latest/latest.json";

/** Platform key the Windows app looks for in the feed. */
export const UPDATER_TARGET = "windows-x86_64";

export interface UpdaterFeed {
  version: string;
  notes: string;
  pubDate: string;
  url: string;
  signature: string;
}

/** Parse "1.2.3" (leading "v" allowed, build metadata ignored). Null when not semver. */
export function parseSemver(v: unknown): [number, number, number] | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (s.startsWith("v") || s.startsWith("V")) s = s.slice(1);
  const plus = s.indexOf("+");
  if (plus !== -1) s = s.slice(0, plus);
  const dash = s.indexOf("-");
  if (dash !== -1) {
    if (dash === s.length - 1) return null; // trailing dash = empty pre-release
    s = s.slice(0, dash);
  }
  const parts = s.split(".");
  if (parts.length < 1 || parts.length > 3) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (p === "" || !/^\d+$/.test(p)) return null;
    nums.push(Number(p));
  }
  while (nums.length < 3) nums.push(0);
  return [nums[0], nums[1], nums[2]];
}

/** -1 / 0 / 1. Unparseable versions compare equal (never an update). */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/** True only when `latest` is a valid semver strictly newer than `current`. */
export function isNewerVersion(current: string, latest: string): boolean {
  if (!parseSemver(current) || !parseSemver(latest)) return false;
  return compareVersions(current, latest) < 0;
}

/**
 * Parse a `latest.json` body. Requires a valid semver `version` and a
 * `platforms["windows-x86_64"]` entry with a non-empty `url` and
 * `signature` (the signature is the CONTENT of the .sig file, never a
 * path — the updater rejects a feed whose signature is a link). Anything
 * else yields null: a bad feed is a silent no-op, never an error.
 */
export function parseUpdaterFeed(value: unknown): UpdaterFeed | null {
  if (typeof value !== "object" || value === null) return null;
  const f = value as Record<string, unknown>;
  if (!parseSemver(f.version)) return null;
  const platforms = f.platforms;
  if (typeof platforms !== "object" || platforms === null) return null;
  const entry = (platforms as Record<string, unknown>)[UPDATER_TARGET];
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.url !== "string" || e.url.trim() === "") return null;
  if (typeof e.signature !== "string" || e.signature.trim() === "") return null;
  return {
    version: String(f.version).trim(),
    notes: typeof f.notes === "string" ? f.notes : "",
    pubDate: typeof f.pub_date === "string" ? f.pub_date : "",
    url: (e.url as string).trim(),
    signature: (e.signature as string).trim(),
  };
}
