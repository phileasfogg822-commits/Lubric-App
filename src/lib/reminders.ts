import type { Reminder } from "./types";
import { dbSelect, dbExecute } from "./db";

/**
 * Reminder / notification helpers shared by the dashboard panel, the sidebar
 * bell, the Reminders page and the POS auto-reminder.
 *
 * Lifecycle: pending -> done | dismissed. A reminder with `recurrence_days`
 * set re-creates itself when completed (handled in completeReminder), so
 * recurring to-dos and service intervals repeat without manual setup.
 */

export const REMINDER_KINDS = [
  { key: "service_due",     label: "Service due",      icon: "\u{1F527}", color: "#2563eb" },
  { key: "vendor_meeting",  label: "Vendor meeting",   icon: "\u{1F91D}", color: "#7c3aed" },
  { key: "credit_followup", label: "Credit follow-up", icon: "\u{1F4B0}", color: "#b45309" },
  { key: "todo",            label: "To-do",            icon: "\u2705",    color: "#16a34a" },
] as const;

export function kindMeta(kind: string) {
  return REMINDER_KINDS.find((k) => k.key === kind) ?? REMINDER_KINDS[3];
}

/** Reminder joined with its customer / vendor / vehicle labels. */
export interface ReminderWithRefs extends Reminder {
  customer_name: string | null;
  vendor_name: string | null;
  vehicle_label: string | null;
  /** Who the reminder is about, for list rendering ("Jane / ABC-123"). */
  about: string;
}

/** The one SQL snippet every list uses, so counts and rows always agree.
 * The vehicle label is plain || concatenation, not Postgres'
 * TRIM(BOTH FROM CONCAT_WS(...)): the Windows app died on it with
 * 'near "FROM": syntax error' (reported 2026-11-25). || with COALESCE
 * is valid on both engines; a NULL middle field leaves a double space
 * inside the label, cosmetic only. Keep SQL comments out of this
 * literal: the sim's sqlx-faithful binder does not model `--`
 * comments, and an apostrophe inside one scrambles its quote tracking
 * and misbinds the $N parameters. */
export const REMINDER_SELECT = `
  SELECT r.*,
    c.name  AS customer_name,
    vd.name AS vendor_name,
    NULLIF(TRIM(COALESCE(v.make, '') || ' ' || COALESCE(v.model, '') || ' ' || COALESCE(v.registration, '')), '') AS vehicle_label,
    COALESCE(c.name, vd.name,
      NULLIF(TRIM(COALESCE(v.make, '') || ' ' || COALESCE(v.model, '') || ' ' || COALESCE(v.registration, '')), ''),
      'Shop') AS about
  FROM reminders r
  LEFT JOIN customers c  ON c.id  = r.customer_id
  LEFT JOIN vendors   vd ON vd.id = r.vendor_id
  LEFT JOIN vehicles  v  ON v.id  = r.vehicle_id
`;

/**
 * Complete or dismiss a reminder, re-creating it when it recurs.
 *
 * One shared helper for the bell, the dashboard panel and the Reminders
 * page (their three act() bodies were identical). The old form was a
 * single Postgres statement — WITH d AS (UPDATE ... RETURNING *) INSERT
 * INTO ... SELECT due_at + (recurrence_days || ' days')::interval ...
 * — and SQLite supports neither a data-modifying CTE ('near "UPDATE":
 * syntax error') nor ::interval, so completing a recurring reminder on
 * the Windows app always failed. The steps below are each portable:
 * the UPDATE, then a re-INSERT whose due date shifts by the recurrence
 * (the ::interval there is translated by pgToSqlite locally and runs
 * verbatim on Postgres). The pending-only guard makes a double tap
 * idempotent: the second call finds the row already done and stops.
 */
export async function actOnReminder(id: number, mode: "done" | "dismissed"): Promise<void> {
  const rows = await dbSelect<Reminder>("SELECT * FROM reminders WHERE id = $1", [id]);
  const r = rows[0];
  if (!r || r.status !== "pending") return;
  await dbExecute(
    "UPDATE reminders SET status=$2, completed_at=now(), updated_at=now() WHERE id=$1",
    [id, mode]
  );
  if (mode === "done" && r.recurrence_days != null) {
    await dbExecute(
      `INSERT INTO reminders (shop_id, kind, title, details, due_at, due_km, last_mileage,
         customer_id, vehicle_id, vendor_id, order_id, priority, recurrence_days, created_by_user_id)
       SELECT shop_id, kind, title, details, due_at + (recurrence_days || ' days')::interval,
         due_km, last_mileage, customer_id, vehicle_id, vendor_id, order_id, priority,
         recurrence_days, created_by_user_id
       FROM reminders WHERE id = $1`,
      [id]
    );
  }
}

export type Bucket = "overdue" | "today" | "upcoming";

/** Urgency bucket shared by the panel and the bell. */
export function bucketOf(r: { due_at: string | null }): Bucket {
  if (!r.due_at) return "upcoming";
  const due = new Date(r.due_at).getTime();
  if (Number.isNaN(due)) return "upcoming";
  const now = Date.now();
  if (due < now) return "overdue";
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  return due <= endOfDay.getTime() ? "today" : "upcoming";
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "today 15:00", "tomorrow 09:30", "in 2 month(s)", "3 day(s) overdue". */
export function relativeDue(dueAt: string | null): string {
  if (!dueAt) return "No date";
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "No date";
  const diff = due - Date.now();
  const abs = Math.abs(diff);

  const d = new Date(due);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = new Date().toDateString() === d.toDateString();
  const tomorrow = new Date(Date.now() + DAY).toDateString() === d.toDateString();

  if (diff >= 0) {
    if (sameDay) return `today ${hhmm}`;
    if (tomorrow) return `tomorrow ${hhmm}`;
    if (abs < 30 * DAY) return `in ${Math.max(1, Math.round(abs / DAY))} day(s)`;
    if (abs < 365 * DAY) return `in ${Math.round(abs / (30 * DAY))} month(s)`;
    return `in ${Math.round(abs / (365 * DAY))} year(s)`;
  }
  if (abs < DAY) return `${Math.max(1, Math.round(abs / HOUR))} hr(s) overdue`;
  if (abs < 30 * DAY) return `${Math.round(abs / DAY)} day(s) overdue`;
  return `${Math.round(abs / (30 * DAY))} month(s) overdue`;
}

/** Low / normal / high -> dot colour for the notification rows. */
export function priorityColor(p: string): string {
  return p === "high" ? "#dc2626" : p === "low" ? "#94a3b8" : "#d97706";
}
