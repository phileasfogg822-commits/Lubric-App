package app.lubric.desktop.data.sync

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject

/**
 * Pure value normalization for pull rows, mirroring what the web app's
 * `capDb` binder does: the pull carries JSON booleans and JSONB objects,
 * but SQLite only binds null / String / Number / byte[].
 *
 * - JsonNull -> null
 * - JsonPrimitive boolean -> 1 / 0 (Int)
 * - JsonPrimitive number -> Double if it has a fraction, else Long
 * - JsonPrimitive string -> String
 * - JsonObject / JsonArray -> compact JSON string (via Gson)
 *
 * `json_object` in the outbox triggers produces JSON null for NULL values,
 * which matches the web behaviour; nothing here special-cases it.
 */
object SyncNormalize {

    private val gson = Gson()

    fun normalizeValue(element: JsonElement): Any? {
        if (element.isJsonNull) return null
        if (element.isJsonPrimitive) {
            val primitive = element.asJsonPrimitive
            if (primitive.isBoolean) return if (primitive.asBoolean) 1 else 0
            if (primitive.isNumber) {
                val text = primitive.asString
                return if ('.' in text || 'e' in text || 'E' in text) {
                    primitive.asDouble
                } else {
                    try {
                        primitive.asLong
                    } catch (_: NumberFormatException) {
                        primitive.asDouble
                    }
                }
            }
            if (primitive.isString) return primitive.asString
        }
        // JsonObject / JsonArray -> compact JSON text (e.g. inspection_data).
        return gson.toJson(element)
    }

    /** Same per key, dropping the `id` key — the server owns `id`. */
    fun normalizeRow(row: JsonObject): Map<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        for ((key, value) in row.entrySet()) {
            if (key == "id") continue
            out[key] = normalizeValue(value)
        }
        return out
    }
}
