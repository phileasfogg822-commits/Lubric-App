package app.lubric.desktop.data.reminders

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.ReminderEntity

/**
 * Read queries for the Reminders screen (`src/modules/reminders/Reminders.tsx`).
 *
 * Ordering mirrors the web query exactly: pending rows first, rows without a
 * due date last, then `due_at` ascending, newest id first as the tie-break.
 * (SQLite sorts NULLs first in ASC, so the `due_at IS NULL` CASE is what
 * pushes undated rows last — the web's `NULLS LAST` does not exist here.)
 *
 * NOTE: this DAO must be registered on [app.lubric.desktop.data.db.LubricDatabase]
 * as `abstract fun reminderQueriesDao(): ReminderQueriesDao` (coordinator-owned
 * wiring; this package may not edit LubricDatabase.kt).
 */
@Dao
interface ReminderQueriesDao {

    @Query(
        "SELECT * FROM reminders ORDER BY " +
            "CASE WHEN status = 'pending' THEN 0 ELSE 1 END, " +
            "CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, " +
            "due_at ASC, id DESC",
    )
    suspend fun listAllOrdered(): List<ReminderEntity>

    @Query(
        "SELECT * FROM reminders WHERE status = :status ORDER BY " +
            "CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, " +
            "due_at ASC, id DESC",
    )
    suspend fun byStatus(status: String): List<ReminderEntity>

    @Query(
        "SELECT * FROM reminders WHERE kind = :kind ORDER BY " +
            "CASE WHEN status = 'pending' THEN 0 ELSE 1 END, " +
            "CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, " +
            "due_at ASC, id DESC",
    )
    suspend fun byKind(kind: String): List<ReminderEntity>

    @Query(
        "SELECT * FROM reminders WHERE vehicle_id = :vehicleId ORDER BY " +
            "CASE WHEN status = 'pending' THEN 0 ELSE 1 END, " +
            "CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, " +
            "due_at ASC, id DESC",
    )
    suspend fun byVehicle(vehicleId: Int): List<ReminderEntity>

    @Query("SELECT * FROM reminders WHERE id = :id LIMIT 1")
    suspend fun getById(id: Long): ReminderEntity?
}
