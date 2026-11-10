package app.lubric.desktop.data.inspections

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.InspectionEntity

/**
 * Read queries for vehicle inspections.
 *
 * The web app has no inspection screen (src/modules/inspections/
 * Inspections.tsx is a "coming soon" stub); the behaviour reproduced here
 * comes from the schema: inspections linked to customer/vehicle/order with
 * inspection_data as a JSON object (TEXT holding JSON locally, JSONB on the
 * server) plus a notes column.
 *
 * NOTE FOR THE COORDINATOR: this DAO is not yet registered on
 * [app.lubric.desktop.data.db.LubricDatabase] (that file is owned by the
 * coordinator) — add `abstract fun inspectionQueriesDao(): InspectionQueriesDao`
 * there. Until then [InspectionRepository] reads through the existing DAOs
 * plus raw queries on `db.openHelper`, so this interface is compiled but
 * not yet called at runtime.
 */
@Dao
interface InspectionQueriesDao {

    @Query("SELECT * FROM inspections ORDER BY created_at DESC")
    suspend fun listAll(): List<InspectionEntity>

    @Query(
        "SELECT * FROM inspections WHERE customer_id = :customerId " +
            "ORDER BY created_at DESC",
    )
    suspend fun byCustomer(customerId: Int): List<InspectionEntity>

    @Query(
        "SELECT * FROM inspections WHERE vehicle_id = :vehicleId " +
            "ORDER BY created_at DESC",
    )
    suspend fun byVehicle(vehicleId: Int): List<InspectionEntity>

    @Query(
        "SELECT * FROM inspections WHERE notes LIKE '%' || :q || '%' " +
            "ORDER BY created_at DESC",
    )
    suspend fun searchByNotes(q: String): List<InspectionEntity>

    @Query("SELECT * FROM inspections WHERE id = :id LIMIT 1")
    suspend fun getById(id: Long): InspectionEntity?
}
