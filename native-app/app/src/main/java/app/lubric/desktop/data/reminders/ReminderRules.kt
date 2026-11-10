package app.lubric.desktop.data.reminders

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Pure reminder rules, mirroring the web app (`src/lib/reminders.ts`,
 * `src/modules/reminders/Reminders.tsx`). No Android or Room imports, so
 * unit tests run on the JVM.
 *
 * Lifecycle (web): pending -> done | dismissed; either completed state can
 * reopen back to pending. The web also re-creates a reminder on completion
 * when `recurrence_days` is set — that is NOT in [reminderStatusAfter];
 * see [ReminderRepository.markDone] for the gap.
 */

/** CHECK values on `reminders.kind` (survey §4.2). */
val REMINDER_KINDS: Set<String> =
    setOf("service_due", "vendor_meeting", "todo", "credit_followup")

/** CHECK values on `reminders.priority` (survey §4.2). */
val REMINDER_PRIORITIES: Set<String> = setOf("low", "normal", "high")

/** Label for a reminder kind (web `REMINDER_KINDS`). */
fun reminderKindLabel(kind: String): String = when (kind) {
    "service_due" -> "Service due"
    "vendor_meeting" -> "Vendor meeting"
    "credit_followup" -> "Credit follow-up"
    else -> "To-do"
}

/**
 * The status a reminder lands in after [action] ("done" | "dismissed" |
 * "reopen") from [currentStatus]. Throws [IllegalArgumentException] for an
 * unknown action or a transition the web does not allow (e.g. marking an
 * already-done reminder done again).
 */
fun reminderStatusAfter(currentStatus: String, action: String): String = when (action) {
    "done" -> {
        require(currentStatus == "pending") { "Only pending reminders can be marked done" }
        "done"
    }
    "dismissed" -> {
        require(currentStatus == "pending") { "Only pending reminders can be dismissed" }
        "dismissed"
    }
    "reopen" -> {
        require(currentStatus == "done" || currentStatus == "dismissed") {
            "Only done or dismissed reminders can be reopened"
        }
        "pending"
    }
    else -> throw IllegalArgumentException("Unknown reminder action: $action")
}

/**
 * Parse an ISO date/datetime to epoch millis. Accepts a bare date
 * ("2026-11-20"), a local datetime ("2026-11-20T09:30:00"), and a
 * zoned instant ("2026-11-20T09:30:00Z"). Returns null when the text is
 * blank or unparseable — the web treats those as "upcoming" / "No date".
 */
fun parseIsoMillis(value: String?): Long? {
    val text = value?.trim().orEmpty()
    if (text.isEmpty()) return null
    try {
        return Instant.parse(text).toEpochMilli()
    } catch (_: Exception) {
        // Not a zoned instant; fall through.
    }
    try {
        return LocalDateTime.parse(text).atZone(ZoneId.systemDefault())
            .toInstant().toEpochMilli()
    } catch (_: Exception) {
        // Not a local datetime; fall through.
    }
    return try {
        LocalDate.parse(text).atStartOfDay(ZoneId.systemDefault())
            .toInstant().toEpochMilli()
    } catch (_: Exception) {
        null
    }
}

private const val DAY_MILLIS = 86_400_000L

/**
 * Urgency bucket (web `bucketOf`): "overdue" when the due time has passed,
 * "today" when it falls before the end of the current day, "upcoming"
 * otherwise. A missing or unparseable due date is "upcoming".
 * [nowMillis] is explicit so tests can pin "today".
 */
fun reminderBucket(dueAt: String?, nowMillis: Long): String {
    val due = parseIsoMillis(dueAt) ?: return "upcoming"
    if (due < nowMillis) return "overdue"
    val zone = ZoneId.systemDefault()
    val endOfDay = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
        .atTime(23, 59, 59, 999_000_000).atZone(zone).toInstant().toEpochMilli()
    return if (due <= endOfDay) "today" else "upcoming"
}

/**
 * Human due label (web `relativeDue`): "today 15:00", "tomorrow 09:30",
 * "in 2 day(s)", "3 day(s) overdue", "No date" when there is no due date.
 * [nowMillis] is explicit so tests can pin "today"/"tomorrow".
 */
fun relativeDue(dueAt: String?, nowMillis: Long): String {
    val due = parseIsoMillis(dueAt) ?: return "No date"
    val zone = ZoneId.systemDefault()
    val dueDateTime = Instant.ofEpochMilli(due).atZone(zone)
    val nowDateTime = Instant.ofEpochMilli(nowMillis).atZone(zone)
    val diff = due - nowMillis
    val abs = kotlin.math.abs(diff)
    val hhmm = "%02d:%02d".format(dueDateTime.hour, dueDateTime.minute)
    val today = nowDateTime.toLocalDate()
    val dueDate = dueDateTime.toLocalDate()
    if (diff >= 0) {
        if (dueDate == today) return "today $hhmm"
        if (dueDate == today.plusDays(1)) return "tomorrow $hhmm"
        if (abs < 30 * DAY_MILLIS) {
            return "in ${maxOf(1, java.lang.Math.round(abs.toDouble() / DAY_MILLIS))} day(s)"
        }
        if (abs < 365 * DAY_MILLIS) {
            return "in ${java.lang.Math.round(abs.toDouble() / (30 * DAY_MILLIS))} month(s)"
        }
        return "in ${java.lang.Math.round(abs.toDouble() / (365 * DAY_MILLIS))} year(s)"
    }
    if (abs < DAY_MILLIS) {
        return "${maxOf(1, java.lang.Math.round(abs.toDouble() / 3_600_000))} hr(s) overdue"
    }
    if (abs < 30 * DAY_MILLIS) {
        return "${java.lang.Math.round(abs.toDouble() / DAY_MILLIS)} day(s) overdue"
    }
    return "${java.lang.Math.round(abs.toDouble() / (30 * DAY_MILLIS))} month(s) overdue"
}
