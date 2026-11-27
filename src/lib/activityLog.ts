import { dbExecute, activeShopId } from "./db";
import type { User } from "./auth";

/**
 * Team activity log — who did what, when (Umar, 2026-11-28).
 *
 * One row per action, written next to the action itself: customer add /
 * edit, expense add / edit / delete, vendor add / edit, purchase
 * invoice save, bill edit / void / delete, khata entry post, team
 * member add / edit, and sign-ins. The Activity page (admin-only)
 * reads this table newest-first.
 *
 * The helper never throws and never blocks: a logging failure must not
 * undo the sale / expense / invoice it was recording. Callers fire it
 * and forget it — `void logAction(...)`.
 *
 * Two engines, one statement: plain INSERT with $N params, no
 * RETURNING, no Postgres-only constructs, so pgToSqlite passes it
 * through locally. The server classifies activity_log writes as open
 * to any authenticated user (see server/index.js) and reads as
 * admin-only, so a cashier can record their own actions but never read
 * anyone else's. The shop comes from the active outlet, matching the
 * row the action itself wrote.
 */
export type ActivityAction = "add" | "edit" | "delete" | "view" | "void" | "login";

export async function logAction(
  user: User | null | undefined,
  action: ActivityAction,
  entity: string,
  entityId?: number | null,
  detail?: string
): Promise<void> {
  if (!user) return;
  try {
    await dbExecute(
      "INSERT INTO activity_log (shop_id, user_id, user_name, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        activeShopId() ?? user.shop_id ?? 1,
        user.id,
        user.full_name ?? user.email ?? "",
        action,
        entity,
        entityId ?? null,
        detail ?? "",
      ]
    );
  } catch {
    // Audit is best-effort by design — see the header.
  }
}
