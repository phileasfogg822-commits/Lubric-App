/**
 * Batch 17 (2026-11-28): announcements fetch — Tauri only, silent offline.
 *
 * Rules:
 *  - Tauri Windows build only: `isTauri()` false → null immediately, so
 *    the VPS web app, ?demo=1 and the portfolio demos never fetch the feed.
 *  - At most once a day: the last-fetch date is kept in localStorage, and
 *    a failed or unreachable feed still counts as "checked today" — a dead
 *    server never gets hammered on every page, and the app never waits on it.
 *  - The fetch is a plain GET with a 5-second timeout and NO identity:
 *    credentials 'omit', no Authorization, no custom headers, no device or
 *    install id. It is the same as loading a public web page.
 *  - Any failure (offline, timeout, bad status, malformed JSON) is a silent
 *    no-op: the caller gets [] and the app works exactly as before.
 */

import { isTauri } from "./db";
import {
  ANNOUNCEMENTS_URL,
  Announcement,
  parseAnnouncementsFeed,
  todayStringLocal,
} from "./announcements";

const SEEN_KEY = "lubric_announcements_seen";
const LAST_FETCH_KEY = "lubric_announcements_last_fetch";
const FETCH_TIMEOUT_MS = 5000;
const MAX_SEEN = 50;

/** Build-time override for testing; the baked VPS URL is the default. */
function feedUrl(): string {
  const override = (import.meta as unknown as { env?: Record<string, string | undefined> })
    .env?.VITE_ANNOUNCEMENTS_URL;
  return override && override.length > 0 ? override : ANNOUNCEMENTS_URL;
}

export function readSeenIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Record a message id as seen (capped, so the list never grows forever). */
export function markAnnouncementSeen(id: string): void {
  try {
    const seen = readSeenIds().filter((x) => x !== id);
    seen.push(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-MAX_SEEN)));
  } catch {
    /* private mode — the banner just shows again next launch */
  }
}

function lastFetchDate(): string | null {
  try {
    return localStorage.getItem(LAST_FETCH_KEY);
  } catch {
    return null;
  }
}

function stampFetchDate(today: string): void {
  try {
    localStorage.setItem(LAST_FETCH_KEY, today);
  } catch {
    /* ignore */
  }
}

/**
 * Fetch the feed once a day at most. Returns the parsed messages (possibly
 * empty) — never throws. Callers filter expiry/seen with pickAnnouncement.
 */
export async function loadAnnouncements(): Promise<Announcement[]> {
  if (!isTauri()) return [];
  const today = todayStringLocal();
  if (lastFetchDate() === today) return [];
  stampFetchDate(today);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(feedUrl(), {
      method: "GET",
      credentials: "omit",
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const body: unknown = await res.json().catch(() => null);
    return parseAnnouncementsFeed(body);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
