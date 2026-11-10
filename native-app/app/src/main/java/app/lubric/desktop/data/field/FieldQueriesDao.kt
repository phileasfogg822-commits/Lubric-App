package app.lubric.desktop.data.field

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.CashMovementEntity
import app.lubric.desktop.data.db.ReservationEntity

/**
 * Read queries for the Field Activity screen
 * (`src/modules/field/FieldActivity.tsx`): cash movements ordered by
 * `occurred_at` descending, reservations ordered by `created_at`
 * descending. List caps mirror the web's `LIMIT 500` (movements) and
 * `LIMIT 300` (reservations).
 *
 * NOTE: this DAO must be registered on [app.lubric.desktop.data.db.LubricDatabase]
 * as `abstract fun fieldQueriesDao(): FieldQueriesDao` (coordinator-owned
 * wiring; this package may not edit LubricDatabase.kt).
 */
@Dao
interface FieldQueriesDao {

    @Query("SELECT * FROM cash_movements ORDER BY occurred_at DESC, id DESC LIMIT :limit")
    suspend fun cashMovements(limit: Int): List<CashMovementEntity>

    @Query(
        "SELECT * FROM cash_movements WHERE kind = :kind " +
            "ORDER BY occurred_at DESC, id DESC LIMIT :limit",
    )
    suspend fun cashMovementsByKind(kind: String, limit: Int): List<CashMovementEntity>

    @Query("SELECT * FROM reservations ORDER BY created_at DESC, id DESC LIMIT :limit")
    suspend fun reservations(limit: Int): List<ReservationEntity>

    @Query(
        "SELECT * FROM reservations WHERE status = :status " +
            "ORDER BY created_at DESC, id DESC LIMIT :limit",
    )
    suspend fun reservationsByStatus(status: String, limit: Int): List<ReservationEntity>
}
