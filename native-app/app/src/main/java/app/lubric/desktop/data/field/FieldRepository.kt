package app.lubric.desktop.data.field

import app.lubric.desktop.data.db.CashMovementEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.ReservationEntity

/**
 * Field repository: read-only lists for the Field Activity screen
 * (`src/modules/field/FieldActivity.tsx`).
 *
 * No writes in this phase — collections, handovers and reservations are
 * created on the field phones and arrive here through sync. The web page
 * also has no writes.
 */
class FieldRepository(private val db: LubricDatabase) {

    /** Cash movements, newest first. Blank/null [kindFilter] returns all kinds. */
    suspend fun cashMovements(kindFilter: String?): List<CashMovementEntity> {
        val dao = db.fieldQueriesDao()
        return if (kindFilter.isNullOrBlank()) {
            dao.cashMovements(500)
        } else {
            dao.cashMovementsByKind(kindFilter, 500)
        }
    }

    /** Reservations, newest first. Blank/null [statusFilter] returns all statuses. */
    suspend fun reservations(statusFilter: String?): List<ReservationEntity> {
        val dao = db.fieldQueriesDao()
        return if (statusFilter.isNullOrBlank()) {
            dao.reservations(300)
        } else {
            dao.reservationsByStatus(statusFilter, 300)
        }
    }
}
