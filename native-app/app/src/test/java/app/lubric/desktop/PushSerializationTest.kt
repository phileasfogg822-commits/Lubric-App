package app.lubric.desktop

import app.lubric.desktop.data.network.PushChange
import app.lubric.desktop.data.network.PushRequest
import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushSerializationTest {

    private val gson = Gson()

    @Test
    fun `push request serializes as changes of table uuid op row with no id inside row`() {
        val row = JsonParser.parseString(
            """{
                "uuid": "prod-uuid-1",
                "shop_id": 1,
                "name": "Engine Oil 4L",
                "price_returning": 4000,
                "active": 1
            }""",
        ).asJsonObject
        val request = PushRequest(
            changes = listOf(
                PushChange(
                    table = "products",
                    uuid = "prod-uuid-1",
                    op = "update",
                    row = row,
                ),
            ),
        )

        val json = JsonParser.parseString(gson.toJson(request)).asJsonObject

        // Exactly {changes:[{table,uuid,op,row}]} at the top level.
        assertEquals(1, json.entrySet().size)
        assertTrue(json.has("changes"))
        val changes = json.getAsJsonArray("changes")
        assertEquals(1, changes.size())

        val change = changes[0].asJsonObject
        assertEquals(setOf("table", "uuid", "op", "row"), change.keySet())
        assertEquals("products", change.get("table").asString)
        assertEquals("prod-uuid-1", change.get("uuid").asString)
        assertEquals("update", change.get("op").asString)

        // The row is inline, with no `id` key (the server owns `id`).
        val serializedRow = change.getAsJsonObject("row")
        assertFalse(serializedRow.has("id"))
        assertEquals("Engine Oil 4L", serializedRow.get("name").asString)
        assertEquals(4000, serializedRow.get("price_returning").asInt)
        assertEquals(1, serializedRow.get("active").asInt)
    }

    @Test
    fun `delete op serializes with the same shape`() {
        val row = JsonParser.parseString("""{"uuid": "cust-uuid-9", "deleted_at": "2026-11-11T00:00:00.000Z"}""")
            .asJsonObject
        val request = PushRequest(
            changes = listOf(PushChange("customers", "cust-uuid-9", "delete", row)),
        )
        val json = JsonParser.parseString(gson.toJson(request)).asJsonObject
        val change = json.getAsJsonArray("changes")[0].asJsonObject
        assertEquals("delete", change.get("op").asString)
        assertEquals("cust-uuid-9", change.get("uuid").asString)
        assertFalse(change.getAsJsonObject("row").has("id"))
    }
}
