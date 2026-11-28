/**
 * Batch 17 (2026-11-28): in-app announcements — PURE module (no imports).
 *
 * Umar writes each message once on his server; every online Windows install
 * shows it as a small dismissible banner. The feed is a plain public GET —
 * it sends NO customer data and NO install identity (see
 * announcementsClient.ts: plain fetch, credentials 'omit', no auth headers).
 *
 * This file is deliberately import-free so the sims can load it in plain
 * Node (node --experimental-strip-types): anything that touches
 * import.meta.env, localStorage or Tauri lives in announcementsClient.ts.
 */

/** Public announcements feed. The :9001 front door proxies /api to the API. */
export const ANNOUNCEMENTS_URL =
  "http://72.61.115.120:9001/api/announcements";

/** One message in the feed. `expires` is a YYYY-MM-DD calendar date, inclusive. */
export interface Announcement {
  id: string;
  title: string;
  text: string;
  expires: string | null;
}

/** "2026-11-28" in local time — expiry is a calendar date, not a timestamp. */
export function todayStringLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function parseOne(raw: unknown): Announcement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.trim() === "") return null;
  if (typeof r.title !== "string" || r.title.trim() === "") return null;
  if (typeof r.text !== "string" || r.text.trim() === "") return null;
  let expires: string | null = null;
  if (r.expires !== undefined && r.expires !== null) {
    if (typeof r.expires !== "string" || !isValidDateString(r.expires)) return null;
    expires = r.expires;
  }
  return { id: r.id.trim(), title: r.title.trim(), text: r.text.trim(), expires };
}

/**
 * Parse a fetched feed. Accepts `{ "messages": [...] }` or a bare array.
 * Anything malformed — wrong shape, bad JSON, a bad entry — yields [] or
 * drops just that entry: a bad feed is a silent no-op, never an error.
 */
export function parseAnnouncementsFeed(value: unknown): Announcement[] {
  const list: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null && Array.isArray((value as Record<string, unknown>).messages)
      ? (value as Record<string, unknown>).messages as unknown[]
      : [];
  const out: Announcement[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const a = parseOne(raw);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** True when the message's expiry date has passed (expiry day itself still shows). */
export function isExpired(a: Announcement, today: string): boolean {
  return a.expires !== null && a.expires < today;
}

/**
 * First message in file order that is unexpired and not yet seen. Returns
 * null when there is nothing new — the banner stays hidden.
 */
export function pickAnnouncement(
  messages: Announcement[],
  seenIds: string[],
  today: string
): Announcement | null {
  const seen = new Set(seenIds);
  for (const m of messages) {
    if (seen.has(m.id)) continue;
    if (isExpired(m, today)) continue;
    return m;
  }
  return null;
}
