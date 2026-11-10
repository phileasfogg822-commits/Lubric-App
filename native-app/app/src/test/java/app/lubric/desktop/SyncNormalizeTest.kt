package app.lubric.desktop

import app.lubric.desktop.data.sync.SyncNormalize
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncNormalizeTest {

    private fun parse(json: String) = JsonParser.parseString(json)

    @Test
    fun `true becomes 1 and false becomes 0`() {
        assertEquals(1, SyncNormalize.normalizeValue(parse("true")))
        assertEquals(0, SyncNormalize.normalizeValue(parse("false")))
    }

    @Test
    fun `null becomes null`() {
        assertNull(SyncNormalize.normalizeValue(parse("null")))
    }

    @Test
    fun `whole numbers become Long`() {
        val value = SyncNormalize.normalizeValue(parse("42"))
        assertEquals(42L, value)
        assertTrue(value is Long)
    }

    @Test
    fun `fractional numbers become Double`() {
        val value = SyncNormalize.normalizeValue(parse("4.5"))
        assertEquals(4.5, value)
        assertTrue(value is Double)
    }

    @Test
    fun `strings pass through unchanged`() {
        assertEquals("Zafar Lubricants", SyncNormalize.normalizeValue(parse("\"Zafar Lubricants\"")))
    }

    @Test
    fun `JsonObject becomes compact JSON string`() {
        val value = SyncNormalize.normalizeValue(parse("""{"chain":"worn"}"""))
        assertEquals("""{"chain":"worn"}""", value)
    }

    @Test
    fun `JsonArray becomes compact JSON string`() {
        val value = SyncNormalize.normalizeValue(parse("""["a",1,true]"""))
        assertEquals("""["a",1,true]""", value)
    }

    @Test
    fun `row normalization drops id and converts booleans`() {
        val row = parse(
            """{
                "id": 99,
                "uuid": "abc-123",
                "name": "Engine Oil 4L",
                "price_returning": 4000,
                "active": true,
                "price_walking": null
            }""",
        ).asJsonObject
        val normalized = SyncNormalize.normalizeRow(row)

        assertFalse(normalized.containsKey("id"))
        assertEquals("abc-123", normalized["uuid"])
        assertEquals("Engine Oil 4L", normalized["name"])
        assertEquals(4000L, normalized["price_returning"])
        assertEquals(1, normalized["active"])
        assertTrue(normalized.containsKey("price_walking"))
        assertNull(normalized["price_walking"])
    }
}
