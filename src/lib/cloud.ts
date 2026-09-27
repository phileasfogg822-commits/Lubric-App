/**
 * Cloud (VPS) connection settings for the sync agent and the Android APK.
 * Stored in localStorage; the desktop Shop Settings page writes them.
 */

const CLOUD_URL_KEY = "lubric_cloud_url";
const DEVICE_TOKEN_KEY = "lubric_device_token";

export function getCloudBase(): string | null {
  try {
    const v = localStorage.getItem(CLOUD_URL_KEY);
    return v && v.trim() ? v.trim().replace(/\/+$/, "") : null;
  } catch { return null; }
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
