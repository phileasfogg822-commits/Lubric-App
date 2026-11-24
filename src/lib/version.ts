/**
 * Build identity — so Umar can tell WHICH build is installed on his PC.
 *
 * Before this file, every installer v1–v5 shipped version 0.1.0 and showed
 * no version anywhere in the app, so a bug report could not say which build
 * it came from. The login screen now prints versionLine() and the Version
 * page shows every field below.
 *
 * Values are baked at build time as Vite env vars (see vite.config.ts):
 * vite.config.ts reads them from the environment when present (CI sets
 * them from GITHUB_SHA on the build step) and otherwise from package.json
 * + git, so a plain local `npm run build` bakes the real values too.
 * A dev server has none of them, so every field falls back gracefully
 * ("dev" / "unknown") instead of breaking the render.
 */

function envStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** App version from package.json, e.g. "0.1.1". */
export const APP_VERSION: string = envStr(import.meta.env.VITE_APP_VERSION) ?? "dev";

/** Full 40-char commit SHA of the build, or "unknown". */
export const GIT_SHA: string = envStr(import.meta.env.VITE_GIT_SHA) ?? "unknown";

/** First 7 chars of the commit SHA, e.g. "eeb6634". */
export const GIT_SHA_SHORT: string =
  GIT_SHA === "unknown" ? "unknown" : GIT_SHA.slice(0, 7);

/** Commit subject line of the build, e.g. "Sims for batch 4 ...". */
export const GIT_SUBJECT: string = envStr(import.meta.env.VITE_GIT_SUBJECT) ?? "unknown";

/** Build time as an ISO-8601 UTC string, or "unknown". */
export const BUILD_DATE: string = envStr(import.meta.env.VITE_BUILD_DATE) ?? "unknown";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25 Nov 2026" from an ISO date, in UTC so every build shows the same day. */
export function formatBuildDate(iso: string): string {
  if (!iso || iso === "unknown") return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "25 Nov 2026, 01:30 UTC" from an ISO date, in UTC. */
export function formatBuildDateTime(iso: string): string {
  if (!iso || iso === "unknown") return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatBuildDate(iso)}, ${hh}:${mm} UTC`;
}

/** Login-screen line: "v0.1.1 • build eeb6634 • 25 Nov 2026". */
export function versionLine(): string {
  return `v${APP_VERSION} • build ${GIT_SHA_SHORT} • ${formatBuildDate(BUILD_DATE)}`;
}
