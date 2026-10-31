/**
 * Cloud (VPS) connection settings for the sync agent and the Android APK.
 * Stored in localStorage; the desktop Shop Settings page writes them.
 */

const CLOUD_URL_KEY = "lubric_cloud_url";
const DEVICE_TOKEN_KEY = "lubric_device_token";

export function getCloudBase(): string | null {
  try {
    const v = localStorage.getItem(CLOUD_URL_KEY);
    if (v && v.trim()) return v.trim().replace(/\/+$/, "");
  } catch { /* fall through to the build-time default */ }
  // Phase 3.2: the APK build bakes the hub URL in as VITE_API_URL, so a
  // freshly installed phone syncs without any manual Shop Settings step.
  // Desktop builds leave VITE_API_URL unset and keep the old behaviour
  // (null until the user enters a URL).
  try {
    const env = import.meta.env.VITE_API_URL;
    if (env && String(env).trim()) return String(env).trim().replace(/\/+$/, "");
  } catch { /* ignore */ }
  return null;
}

export function setCloudBase(url: string): void {
  try { localStorage.setItem(CLOUD_URL_KEY, url.trim().replace(/\/+$/, "")); } catch { /* ignore */ }
}

export function getDeviceToken(): string | null {
  try { return localStorage.getItem(DEVICE_TOKEN_KEY); } catch { return null; }
}

export function setDeviceToken(token: string): void {
  try { localStorage.setItem(DEVICE_TOKEN_KEY, token); } catch { /* ignore */ }
}

export function clearDeviceToken(): void {
  try { localStorage.removeItem(DEVICE_TOKEN_KEY); } catch { /* ignore */ }
}
