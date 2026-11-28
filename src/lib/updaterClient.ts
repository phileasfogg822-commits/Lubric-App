/**
 * Batch 17 (2026-11-28): one-click in-app updates — Tauri only, never forced.
 *
 * Flow: on launch the app quietly fetches the updater feed (a plain GET,
 * no identity — same rules as the announcements feed) and compares the
 * feed version with the installed one. If a newer version exists the app
 * offers one clear "Update now" button. NOTHING downloads or installs
 * until the user taps it. The download itself goes through the Tauri
 * updater plugin, which verifies the minisign signature against the public
 * key baked into the app before installing anything.
 *
 * Offline, feed missing, or no newer version: silent no-op. Updates never
 * touch business data (same rule as upgrades: the data dir is untouched)
 * and never touch the trial/licence state.
 */

import { isTauri } from "./db";
import { APP_VERSION } from "./version";
import {
  UPDATER_FEED_URL,
  isNewerVersion,
  parseUpdaterFeed,
} from "./updater";

const FETCH_TIMEOUT_MS = 5000;

export interface AvailableUpdate {
  version: string;
  notes: string;
}

/** Plain GET of the feed, 5-second timeout, no identity. Null on any failure. */
async function fetchUpdaterFeed(): Promise<ReturnType<typeof parseUpdaterFeed>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(UPDATER_FEED_URL, {
      method: "GET",
      credentials: "omit",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body: unknown = await res.json().catch(() => null);
    return parseUpdaterFeed(body);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is a newer version waiting? Tauri only; null when offline, when the feed
 * is missing/malformed, or when the installed version is already current.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const feed = await fetchUpdaterFeed();
  if (!feed) return null;
  if (!isNewerVersion(APP_VERSION, feed.version)) return null;
  return { version: feed.version, notes: feed.notes };
}

/**
 * Download + install the update the plugin found, then restart the app.
 * Called ONLY from the user's tap on "Update now" — never automatically.
 * Throws when the plugin finds no update (e.g. the feed moved on) or the
 * download/install fails; the caller hides the prompt silently.
 */
export async function installUpdate(
  onProgress: (percent: number) => void
): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) throw new Error("no update available");
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      downloaded = 0;
      onProgress(0);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength ?? 0;
      onProgress(total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0);
    } else if (event.event === "Finished") {
      onProgress(100);
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
