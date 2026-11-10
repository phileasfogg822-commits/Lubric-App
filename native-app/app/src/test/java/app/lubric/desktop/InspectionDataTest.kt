package app.lubric.desktop

import app.lubric.desktop.data.inspections.inspectionDataFromJson
import app.lubric.desktop.data.inspections.inspectionDataToJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM tests for the inspection_data JSON helpers used by
 * [app.lubric.desktop.data.inspections.InspectionRepository]: no Room, no
 * Android classes — only the pure functions.
 */
class InspectionDataTest {

    @Test
    fun `map round-trips through json unchanged`() {
        val data = mapOf(
            "brakes" to "ok",
            "tyres" to "attention",
            "fault_codes" to "P0171, P0300",
            "recommendations" to "Replace front pads",
        )
        assertEquals(data, inspectionDataFromJson(inspectionDataToJson(data)))
    }

    @Test
    fun `empty map encodes as an empty object`() {
        assertEquals("{}", inspectionDataToJson(emptyMap()))
        assertEquals(emptyMap<String, String>(), inspectionDataFromJson("{}"))
    }

    @Test
    fun `values with quotes and backslashes survive the round-trip`() {
        val data = mapOf("recommendations" to "Say \"check\" the \\ hose")
        assertEquals(data, inspectionDataFromJson(inspectionDataToJson(data)))
    }

    @Test
    fun `malformed json parses to an empty map instead of throwing`() {
        assertEquals(emptyMap<String, String>(), inspectionDataFromJson("{not json"))
        assertEquals(emptyMap<String, String>(), inspectionDataFromJson("[1, 2, 3]"))
        assertEquals(emptyMap<String, String>(), inspectionDataFromJson("{\"brakes\":"))
    }

    @Test
    fun `blank or null json parses to an empty map`() {
        assertEquals(emptyMap<String, String>(), inspectionDataFromJson(null))
        assertEquals(emptyMap<String, String>(), inspectionDataFromJson(""))
        assertEquals(emptyMap<String, String>(), inspectionDataFromJson("   "))
    }

    @Test
    fun `stored object string parses back to its keys`() {
        val parsed = inspectionDataFromJson(
            "{\"brakes\":\"fail\",\"oil_level\":\"ok\",\"fault_codes\":\"\"}",
        )
        assertEquals("fail", parsed["brakes"])
        assertEquals("ok", parsed["oil_level"])
        assertTrue(parsed.containsKey("fault_codes"))
    }
}
