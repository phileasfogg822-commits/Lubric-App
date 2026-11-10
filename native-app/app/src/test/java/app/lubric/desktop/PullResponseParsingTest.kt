package app.lubric.desktop

import app.lubric.desktop.data.network.PullResponse
import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PullResponseParsingTest {

    private val gson = Gson()

    // A realistic slice of a pull payload: server ids are present (the
    // client drops them), booleans arrive as JSON booleans, inspection_data
    // arrives as a nested object, price_list_items carry natural keys.
    private val sampleJson = """
        {
          "cursor": 1792000000000,
          "server_time": "2026-11-11T02:00:00.000Z",
          "sync_requested_at": null,
          "changes": {
            "products": [
              {
                "id": 7,
                "uuid": "prod-uuid-1",
                "shop_id": 1,
                "name": "Engine Oil 4L",
                "price_returning": 4000,
                "price_walking": 4200.5,
                "active": true,
                "updated_at": "2026-11-10T10:00:00.000Z"
              }
            ],
            "order_items": [
              {
                "id": 101,
                "uuid": "oi-uuid-1",
                "order_id": 55,
                "kind": "product",
                "ref_id": 7,
                "leftover_released": false,
                "billed_by_capacity": true,
                "qty": 1
              }
            ],
            "inspections": [
              {
                "id": 3,
                "uuid": "insp-uuid-1",
                "inspection_data": {"chain": "worn", "brakes": "ok"},
                "notes": "check chain"
              }
            ],
            "price_list_items": [
              {
                "id": 9,
                "price_list_id": 2,
                "product_id": 7,
                "price": 3800,
                "min_qty": 5
              }
            ]
          }
        }
    """.trimIndent()

    @Test
    fun `pull response parses cursor and per-table rows`() {
        val response = gson.fromJson(sampleJson, PullResponse::class.java)

        assertEquals(1792000000000L, response.cursor)
        assertEquals("2026-11-11T02:00:00.000Z", response.serverTime)
        assertNull(response.syncRequestedAt)

        assertEquals(1, response.changes["products"]?.size)
        assertEquals(1, response.changes["order_items"]?.size)
        assertEquals(1, response.changes["inspections"]?.size)
        assertEquals(1, response.changes["price_list_items"]?.size)
    }

    @Test
    fun `booleans survive parsing as JsonPrimitive booleans before normalization`() {
        val response = gson.fromJson(sampleJson, PullResponse::class.java)

        val product = response.changes["products"]!!.first()
        assertTrue(product.get("active").asBoolean)
        assertEquals(4000.0, product.get("price_returning").asDouble, 0.0)
        assertEquals(4200.5, product.get("price_walking").asDouble, 0.0)
        // The server id is present in the wire row; the client drops it.
        assertTrue(product.has("id"))

        val item = response.changes["order_items"]!!.first()
        assertEquals(false, item.get("leftover_released").asBoolean)
        assertEquals(true, item.get("billed_by_capacity").asBoolean)
    }

    @Test
    fun `inspection_data stays a nested object and natural keys stay intact`() {
        val response = gson.fromJson(sampleJson, PullResponse::class.java)

        val inspection = response.changes["inspections"]!!.first()
        val data = inspection.get("inspection_data").asJsonObject
        assertEquals("worn", data.get("chain").asString)
        assertEquals("ok", data.get("brakes").asString)

        val priceItem = response.changes["price_list_items"]!!.first()
        assertEquals(2, priceItem.get("price_list_id").asInt)
        assertEquals(7, priceItem.get("product_id").asInt)
        assertEquals(3800.0, priceItem.get("price").asDouble, 0.0)
    }
}
