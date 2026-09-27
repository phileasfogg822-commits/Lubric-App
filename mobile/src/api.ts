/**
 * Cloud sync for the field app — same /api/v1 endpoints as the desktop agent:
 *   POST /api/v1/devices/pair   (one-time code → device token)
 *   POST /api/v1/push           (outbox rows, uuid-idempotent)
 *   GET  /api/v1/pull           (changes since cursor)
 * Settings (server URL + token) live in localStorage.
 */

import { db, pendingCount } from "./store";

const SERVER_KEY = "lf_server";
const TOKEN_KEY = "lf_token";

export function getServer(): string {
  try { return (localStorage.getItem(SERVER_KEY) ?? "").replace(/\/+$/, ""); } catch { return ""; }
}
export function setServer(url: string): void {
  try { localStorage.setItem(SERVER_KEY, url.trim().replace(/\/+$/, "")); } catch { /* ignore */ }
}
export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
export function setToken(t: string): void {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
}
export function isPaired(): boolean {
  return Boolean(getServer() && getToken());
}

export async function pairDevice(code: string, name: string): Promise<void> {
  const base = getServer();
  if (!base) throw new Error("Enter the server URL first");
  const res = await fetch(`${base}/api/v1/devices/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Pairing failed");
  }
  const data = await res.json();
  setToken(data.token);
}

/** Push outbox → pull customers/reservations. Throws on failure. */
export async function syncNow(): Promise<{ pushed: number; rejected: number; pulled: number }> {
  const base = getServer();
  const token = getToken();
  if (!base || !token) throw new Error("Not paired yet");
  const c = await db();
  let pushed = 0, rejected = 0, pulled = 0;

  // ── push ──
  const outbox = await c.query("SELECT id, table_name, row_uuid, op, payload FROM outbox ORDER BY id LIMIT 200");
  const rows = outbox.values ?? [];
  if (rows.length) {
    const changes = rows.map((r: any) => ({ table: r.table_name, uuid: r.row_uuid, op: r.op, row: JSON.parse(r.payload) }));
    const res = await fetch(`${base}/api/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ changes }),
    });
    if (!res.ok) throw new Error(`Push failed: ${res.status}`);
    const data = await res.json();
    pushed = data.applied?.length ?? 0;
    rejected = data.rejected?.length ?? 0;
    const applied = new Set((data.applied ?? []).map((x: any) => x.uuid));
    for (const r of rows) {
      if (applied.has(r.row_uuid)) {
        await c.run("DELETE FROM outbox WHERE id = ?", [r.id]);
        await c.run(`UPDATE ${r.table_name} SET synced = 1 WHERE uuid = ?`, [r.row_uuid]);
      }
    }
  }

  // ── pull (customers + reservations; cash_movements echo ignored) ──
  const state = await c.query("SELECT value FROM sync_state WHERE key = 'pull_cursor'");
  const cursor = Number(state.values?.[0]?.value ?? 0);
  const res = await fetch(`${base}/api/v1/pull?since=${cursor}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  const data = await res.json();

  for (const row of (data.changes?.customers ?? []) as any[]) {
    await c.run(
      `INSERT INTO customers (uuid, name, phone, customer_type, credit_balance) VALUES (?,?,?,?,?)
       ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, phone = excluded.phone,
         customer_type = excluded.customer_type, credit_balance = excluded.credit_balance`,
      [row.uuid, row.name ?? "", row.phone ?? "", row.customer_type ?? "", Number(row.credit_balance) || 0]
    );
    pulled++;
  }
  for (const row of (data.changes?.reservations ?? []) as any[]) {
    await c.run(
      `INSERT INTO reservations (uuid, customer_name, items_json, amount, status, note, synced) VALUES (?,?,?,?,?,?,1)
       ON CONFLICT(uuid) DO UPDATE SET status = excluded.status, amount = excluded.amount`,
      [row.uuid, row.customer_name ?? "", row.items_json ?? "[]", Number(row.amount) || 0, row.status ?? "open", row.note ?? ""]
    );
    pulled++;
  }
  await c.run("UPDATE sync_state SET value = ? WHERE key = 'pull_cursor'", [String(data.cursor ?? Date.now())]);

  return { pushed, rejected, pulled };
}

export { pendingCount };
