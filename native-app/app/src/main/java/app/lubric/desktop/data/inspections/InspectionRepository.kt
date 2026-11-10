package app.lubric.desktop.data.inspections

import app.lubric.desktop.data.db.CustomerEntity
import app.lubric.desktop.data.db.InspectionEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.VehicleEntity
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.time.Instant
import java.util.UUID

/**
 * Checklist keys stored in inspection_data. The eight checks take one of
 * [INSPECTION_CHECK_VALUES]; the two text keys hold free text. The web
 * module is a "coming soon" stub whose copy promises "vehicle inspections,
 * fault codes, and recommendations", so these keys are the native form's
 * own vocabulary — a pulled inspection whose JSON holds other keys keeps
 * them (they round-trip untouched) but the form only edits these.
 */
val INSPECTION_CHECKLIST_KEYS = listOf(
    "brakes", "lights", "tyres", "oil_level", "coolant", "battery",
    "steering", "suspension",
)
val INSPECTION_CHECK_VALUES = listOf("ok", "attention", "fail")
val INSPECTION_TEXT_KEYS = listOf("fault_codes", "recommendations")

fun inspectionChecklistLabel(key: String): String = when (key) {
    "brakes" -> "Brakes"
    "lights" -> "Lights"
    "tyres" -> "Tyres"
    "oil_level" -> "Oil level"
    "coolant" -> "Coolant"
    "battery" -> "Battery"
    "steering" -> "Steering"
    "suspension" -> "Suspension"
    "fault_codes" -> "Fault codes"
    "recommendations" -> "Recommendations"
    else -> key
}

/**
 * inspection_data (TEXT holding a JSON object) → JSON string.
 *
 * NOTE: the task asked for org.json.JSONObject, but android.jar's org.json
 * is a runtime stub that throws under plain-JVM unit tests, and no real
 * org.json jar is a dependency of this app — while Gson IS (Retrofit
 * converter + the sync tests already serialize JSON with it). Gson writes
 * the identical flat-object format, so the stored text is the same either
 * way.
 */
fun inspectionDataToJson(data: Map<String, String>): String = Gson().toJson(data)

/**
 * JSON string → inspection_data map. Blank, null, or malformed JSON yields
 * an empty map rather than throwing, so one bad stored row cannot break
 * the list or the edit form.
 */
fun inspectionDataFromJson(json: String?): Map<String, String> {
    if (json.isNullOrBlank()) return emptyMap()
    return try {
        val type = object : TypeToken<Map<String, String>>() {}.type
        Gson().fromJson<Map<String, String>>(json, type) ?: emptyMap()
    } catch (e: Exception) {
        emptyMap()
    }
}

/** Inspection form values (add and edit share the same shape). */
data class InspectionForm(
    val customerId: Int?,
    val vehicleId: Int?,
    val orderId: Int?,
    val data: Map<String, String>,
    val notes: String,
    val userId: Int? = null,
)

/**
 * Vehicle inspections: list/search, add/edit, hard delete.
 *
 * The web app has no inspection screen (a "coming soon" stub), so this
 * reproduces the schema's shape: inspections linked to customer/vehicle/
 * order, inspection_data as a JSON object (TEXT holding JSON locally,
 * JSONB on the server — a JSON object is not a bindable SQLite value, so
 * the string is stored, never a raw object), plus notes. The JSON string
 * is mirrored into the legacy `data` column too, matching the pull, which
 * reads both columns.
 *
 * Writes go through the existing DAO upserts, so the outbox triggers queue
 * inspections rows for sync exactly as the web does.
 *
 * List/detail reads go through [InspectionQueriesDao], registered on
 * [LubricDatabase] by the coordinator.
 */
class InspectionRepository(private val db: LubricDatabase) {

    /** All inspections newest first, or those whose notes match [query]. */
    suspend fun inspections(query: String): List<InspectionEntity> =
        if (query.isBlank()) {
            db.inspectionQueriesDao().listAll()
        } else {
            db.inspectionQueriesDao().searchByNotes(query.trim())
        }

    suspend fun inspectionById(id: Long): InspectionEntity? =
        db.inspectionQueriesDao().getById(id)

    /** Customers for the add/edit picker. */
    suspend fun customers(): List<CustomerEntity> = db.customerDao().listAll()

    /** Vehicles of one customer, for the add/edit picker. */
    suspend fun vehicles(customerId: Int): List<VehicleEntity> =
        db.vehicleDao().byCustomer(customerId)

    /**
     * Adds a new inspection, or edits [existingId]'s. Returns the id.
     * A customer is required — an inspection with no customer, vehicle,
     * or order link is a stray row the web has no screen to show.
     */
    suspend fun saveInspection(
        form: InspectionForm,
        shopId: Int,
        existingId: Long? = null,
    ): Long {
        require(form.customerId != null) { "Customer required" }
        val now = Instant.now().toString()
        val json = inspectionDataToJson(form.data)
        if (existingId == null) {
            val uuid = UUID.randomUUID().toString()
            db.inspectionDao().upsert(
                InspectionEntity(
                    shopId = shopId,
                    customerId = form.customerId,
                    vehicleId = form.vehicleId,
                    data = json,
                    notes = form.notes.trim(),
                    userId = form.userId,
                    createdAt = now,
                    orderId = form.orderId,
                    inspectionData = json,
                    uuid = uuid,
                    updatedAt = now,
                ),
            )
            return db.inspectionDao().getByUuid(uuid)?.id
                ?: error("Inspection not found after insert")
        }
        val existing = inspectionById(existingId)
            ?: throw IllegalArgumentException("Inspection not found")
        db.inspectionDao().upsert(
            existing.copy(
                customerId = form.customerId,
                vehicleId = form.vehicleId,
                data = json,
                notes = form.notes.trim(),
                userId = form.userId,
                orderId = form.orderId,
                inspectionData = json,
                updatedAt = now,
            ),
        )
        return existingId
    }

    /**
     * Hard delete. Chosen because the web does neither: the module is a
     * stub with no delete UI, `inspections` is NOT one of the six
     * soft-delete tables (so there is no `deleted_at` column to write —
     * and the server rejects deletes on non-soft-delete tables), and the
     * outbox has no DELETE trigger for inspections. Consequence to know:
     * this removes the local row only; the next pull re-downloads it if
     * the server still holds it. There is no delete button in the UI for
     * exactly that reason — this exists for a future server-side delete.
     */
    suspend fun deleteInspection(id: Long) {
        db.openHelper.writableDatabase.execSQL(
            "DELETE FROM inspections WHERE id = ?",
            arrayOf<Any?>(id),
        )
    }
}
