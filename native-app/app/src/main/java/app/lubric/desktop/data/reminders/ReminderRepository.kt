package app.lubric.desktop.data.reminders

import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.ReminderEntity
import java.time.Instant
import java.util.UUID

/**
 * Reminder repository: list/filter, complete, and add.
 *
 * Mirrors the web Reminders page (`src/modules/reminders/Reminders.tsx`):
 * one ordered list, filtered in memory by tab (status/bucket) and kind.
 * Writes go through [ReminderDao.upsert], so the existing outbox triggers
 * queue them for sync — never write `sync_outbox` rows directly.
 *
 * GAPS vs the web (left for a later package, flagged in the report):
 * - Completing a reminder with `recurrence_days` set does NOT re-create the
 *   next occurrence (web `act()` inserts a follow-up due `recurrence_days`
 *   later). This phase only flips the status.
 * - No reopen (pending again) and no edit of an existing reminder.
 */
class ReminderRepository(private val db: LubricDatabase) {

    /**
     * Reminders in the web's order (pending first, undated last, due date
     * ascending). Pass null/blank for a filter to ignore it; when both
     * filters are set the kind filter is applied in memory over the
     * status-filtered rows, exactly like the web's client-side filter.
     */
    suspend fun reminders(
        statusFilter: String?,
        kindFilter: String?,
    ): List<ReminderEntity> {
        val dao = db.reminderQueriesDao()
        val base = when {
            !statusFilter.isNullOrBlank() -> dao.byStatus(statusFilter)
            !kindFilter.isNullOrBlank() -> dao.byKind(kindFilter)
            else -> dao.listAllOrdered()
        }
        return if (!statusFilter.isNullOrBlank() && !kindFilter.isNullOrBlank()) {
            base.filter { it.kind == kindFilter }
        } else {
            base
        }
    }

    /** Status -> 'done', `completed_at` = now. Only a pending reminder can be done. */
    suspend fun markDone(id: Long) {
        complete(id, "done")
    }

    /** Status -> 'dismissed', `completed_at` = now. Only a pending reminder can be dismissed. */
    suspend fun markDismissed(id: Long) {
        complete(id, "dismissed")
    }

    private suspend fun complete(id: Long, action: String) {
        val existing = db.reminderQueriesDao().getById(id)
            ?: throw IllegalArgumentException("Reminder not found")
        val next = reminderStatusAfter(existing.status, action)
        val now = Instant.now().toString()
        db.reminderDao().upsert(
            existing.copy(status = next, completedAt = now, updatedAt = now),
        )
    }

    /**
     * Insert a new pending reminder. [kind] must be one of
     * service_due / vendor_meeting / todo / credit_followup and [priority]
     * one of low / normal / high (the `reminders` CHECK values, survey
     * §4.2). [dueAt] is ISO text ("YYYY-MM-DD" or a datetime); blank
     * becomes null (no due date). Returns the new row's id.
     */
    suspend fun addReminder(
        kind: String,
        title: String,
        details: String,
        dueAt: String?,
        customerId: Int? = null,
        vehicleId: Int? = null,
        vendorId: Int? = null,
        priority: String = "normal",
        shopId: Int = 1,
    ): Long {
        require(kind in REMINDER_KINDS) { "Unknown reminder kind: $kind" }
        require(priority in REMINDER_PRIORITIES) { "Unknown priority: $priority" }
        require(title.isNotBlank()) { "Title required" }
        val now = Instant.now().toString()
        val uuid = UUID.randomUUID().toString()
        db.reminderDao().upsert(
            ReminderEntity(
                shopId = shopId,
                kind = kind,
                title = title.trim(),
                details = details.trim(),
                dueAt = dueAt?.trim()?.ifBlank { null },
                customerId = customerId,
                vehicleId = vehicleId,
                vendorId = vendorId,
                priority = priority,
                status = "pending",
                createdAt = now,
                updatedAt = now,
                uuid = uuid,
            ),
        )
        return db.reminderDao().getByUuid(uuid)?.id
            ?: throw IllegalStateException("Reminder was not saved")
    }
}
