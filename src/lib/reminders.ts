import type { Reminder } from "./types";

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

/** The one SQL snippet every list uses, so counts and rows always agree. */
export const REMINDER_SELECT = `
  SELECT r.*,
    c.name  AS customer_name,
    vd.name AS vendor_name,
    NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', v.make, v.model, v.registration)), '') AS vehicle_label,
    COALESCE(c.name, vd.name,
      NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', v.make, v.model, v.registration)), ''),
      'Shop') AS about
  FROM reminders r
  LEFT JOIN customers c  ON c.id  = r.customer_id
  LEFT JOIN vendors   vd ON vd.id = r.vendor_id
  LEFT JOIN vehicles  v  ON v.id  = r.vehicle_id
`;

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
