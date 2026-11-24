/**
 * What the login screen is allowed to remember: EMAILS ONLY, never
 * passwords.
 *
 * The browser/webview was remembering passwords because nothing told it
 * not to — and the signed-in user row (which carries password_hash) was
 * persisted to localStorage whole. Both are fixed here:
 *
 *  - `rememberEmail` keeps a short list of previously used emails on this
 *    device, so the login screen can offer them as clickable user boxes
 *    (Windows XP style). No password, hash or token is ever written here.
 *  - `stripPasswordHash` removes the hash from a user row before it is
 *    stored; the session only needs id/email/role/permissions.
 *
 * Kept in this tiny module (no React, no db) so the logic is unit-testable
 * from node — see server/unit_login_storage.js.
 */

const REMEMBERED_KEY = "lubric_remembered_emails";
const MAX_REMEMBERED = 6;

/** Emails previously signed in on this device, most recent first. */
export function getRememberedEmails(): string[] {
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** Remember an email for the user picker. Passwords are never passed here. */
export function rememberEmail(email: string): void {
  const clean = email.trim().toLowerCase();
  if (!clean) return;
  const next = [clean, ...getRememberedEmails().filter((e) => e !== clean)].slice(0, MAX_REMEMBERED);
  try {
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify(next));
  } catch {
    /* private mode — the picker just stays empty */
  }
}

/**
 * A user row safe to persist: everything the session needs, with the
 * password hash blanked. The hash is only ever needed at the moment of
 * verification (bcrypt.compare against the database row), never after.
 */
export function stripPasswordHash<T extends { password_hash?: unknown }>(
  user: T
): Omit<T, "password_hash"> & { password_hash: string } {
  const { password_hash: _omit, ...rest } = user;
  void _omit;
  return { ...rest, password_hash: "" };
}
