/**
 * Device pairing — attaching a phone (or another desktop) to this shop.
 *
 * How it works: the shop owner creates a one-time code, types it into the new
 * device, and that device exchanges it for a long-lived token. The token is
 * what lets it sync (server/index.js → POST /api/v1/devices/pair). The code is
 * spent the moment it is used, so a code found on a lost phone is worthless.
 *
 * Only people who manage the team can see or issue codes: a code IS a permanent
 * sync token in waiting, which is why `devices` sits behind the team.manage
 * permission in the server's SQL guard.
 *
 * The cloud is the authority for tokens, so this needs the shop server. In
 * local (offline desktop) mode there is nothing to pair against and
 * `canManageDevices` returns false.
 */

import { dbSelect, dbExecute, getDbMode } from "./db";
import { newPairingCode } from "./uuid";

export { newPairingCode };

export type DeviceKind = "desktop" | "mobile";
export type DeviceStatus = "paired" | "waiting" | "revoked";

export interface Device {
  id: number;
  kind: DeviceKind;
  name: string;
  status: DeviceStatus;
  last_sync_at: string | null;
  created_at: string;
  /** Set when the shop has asked this device to sync and it has not yet. */
  sync_requested_at?: string | null;
}

export interface PendingCode {
  id: number;
  code: string;
  name: string;
  kind: DeviceKind;
}

/** Pairing needs the shop server, which is what holds and checks the codes. */
export function canManageDevices(): boolean {
  return getDbMode() !== "local";
}

/**
 * Every device this shop has, newest first. A row with a pairing code has not
 * been claimed yet; the server clears the code when the device pairs.
 */
export async function listDevices(): Promise<Device[]> {
  const rows = await dbSelect<any>(
    // Sort keys in a SELECT list, not in ORDER BY: Postgres does not accept a
    // bare `ORDER BY (boolean ASC)` - a direction can only qualify a column
    // name, so the expression form is a syntax error.
    `SELECT id, kind, name, pairing_code, last_sync_at, created_at, revoked,
            sync_requested_at,
            (revoked OR pairing_code IS NOT NULL) AS needs_attention
       FROM devices
      ORDER BY needs_attention DESC, id DESC`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind === "mobile" ? "mobile" : "desktop",
    name: String(r.name ?? ""),
    status: r.revoked ? "revoked" : r.pairing_code ? "waiting" : "paired",
    last_sync_at: r.last_sync_at ? String(r.last_sync_at) : null,
    created_at: String(r.created_at ?? ""),
    sync_requested_at: r.sync_requested_at ? String(r.sync_requested_at) : null,
  }));
}

/** How many phones are attached and usable right now. */
export function countPhones(devices: Device[]): { paired: number; waiting: number } {
  return {
    paired: devices.filter((d) => d.kind === "mobile" && d.status === "paired").length,
    waiting: devices.filter((d) => d.kind === "mobile" && d.status === "waiting").length,
  };
}

/**
 * Ask a phone to sync now.
 *
 * A phone is behind the shop's NAT and holds no open connection, so the server
 * cannot reach into it. What this does is leave a timestamp that the phone picks
 * up the next time it syncs - typically within a minute of it opening the app,
 * since it syncs on start. It is a nudge, not a remote trigger, and the UI says
 * so rather than implying the data has already moved.
 */
export async function requestDeviceSync(id: number): Promise<void> {
  await dbExecute("UPDATE devices SET sync_requested_at = NOW() WHERE id = $1", [id]);
}

/**
 * Create a one-time code for a new device and return it for the owner to read
 * out / type in. Any number of phones can be added this way, one code each.
 *
 * The code is generated here rather than in the database so the shop never has
 * to touch the server console, but it is written through the normal permission
 * guard, so only a team manager can do this.
 */
export async function createPairingCode(
  name: string,
  kind: DeviceKind = "mobile"
): Promise<PendingCode> {
  const label = name.trim() || (kind === "mobile" ? "Field phone" : "Desktop");

  // pairing_code is UNIQUE, so a clash (1 in 4 billion) is retried rather than
  // surfacing as a database error the owner cannot act on.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPairingCode();
    try {
      const res = await dbExecute(
        `INSERT INTO devices (shop_id, kind, name, pairing_code)
         VALUES (1, $1, $2, $3) RETURNING id`,
        [kind, label, code]
      );
      const id = Number((res.rows?.[0] as { id?: number } | undefined)?.id);
      if (id) return { id, code, name: label, kind };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/duplicate|unique/i.test(msg)) throw e;
      // Collision - draw again.
    }
  }
  throw new Error("Could not create a pairing code. Please try again.");
}

/**
 * Revoke a device: a lost or sold phone must not keep syncing. Also spends any
 * unclaimed code, so a code sitting unused can never be used later.
 */
export async function revokeDevice(id: number): Promise<void> {
  await dbExecute("UPDATE devices SET revoked = TRUE, pairing_code = NULL WHERE id = $1", [id]);
}
