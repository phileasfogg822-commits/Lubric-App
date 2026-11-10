package app.lubric.desktop

import app.lubric.desktop.data.db.PriceMemoryRow
import app.lubric.desktop.data.pricing.buildPriceMemory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PriceMemoryTest {

    private fun row(
        refId: Int = 1,
        unitPrice: Double = 3500.0,
        qty: Double = 1.0,
        capacity: Double = 3.5,
        billedByCapacity: Boolean = false,
        orderId: Int = 10,
        createdAt: String = "2026-11-10T10:00:00Z",
    ) = PriceMemoryRow(
        refId = refId,
        productName = "Engine Oil 4L",
        unitPrice = unitPrice,
        qty = qty,
        capacity = capacity,
        billedByCapacity = billedByCapacity,
        orderId = orderId,
        createdAt = createdAt,
    )

    @Test
    fun `newest rows come first`() {
        val rows = listOf(
            row(orderId = 8, createdAt = "2026-11-08T10:00:00Z", unitPrice = 3300.0),
            row(orderId = 10, createdAt = "2026-11-10T10:00:00Z", unitPrice = 3500.0),
            row(orderId = 9, createdAt = "2026-11-09T10:00:00Z", unitPrice = 3400.0),
        )
        val result = buildPriceMemory(rows, mapOf(1 to 4.0), emptyMap(), 10)
        assertEquals(
            listOf(3500.0, 3400.0, 3300.0),
            result.getValue(1).map { it.unitPrice },
        )
    }

    @Test
    fun `same timestamp breaks ties by order id descending`() {
        val rows = listOf(
            row(orderId = 9, createdAt = "2026-11-10T10:00:00Z", unitPrice = 3400.0),
            row(orderId = 12, createdAt = "2026-11-10T10:00:00Z", unitPrice = 3500.0),
        )
        val result = buildPriceMemory(rows, mapOf(1 to 4.0), emptyMap(), 10)
        assertEquals(
            listOf(3500.0, 3400.0),
            result.getValue(1).map { it.unitPrice },
        )
    }

    @Test
    fun `limit caps entries per product`() {
        val rows = listOf(
            row(orderId = 10, createdAt = "2026-11-10T10:00:00Z", unitPrice = 3500.0),
            row(orderId = 9, createdAt = "2026-11-09T10:00:00Z", unitPrice = 3400.0),
            row(orderId = 8, createdAt = "2026-11-08T10:00:00Z", unitPrice = 3300.0),
        )
        val result = buildPriceMemory(rows, mapOf(1 to 4.0), emptyMap(), 2)
        assertEquals(2, result.getValue(1).size)
        assertEquals(
            listOf(3500.0, 3400.0),
            result.getValue(1).map { it.unitPrice },
        )
    }

    @Test
    fun `per-litre filter keeps only rows within 0 05 litres of the target`() {
        val rows = listOf(
            row(orderId = 10, createdAt = "2026-11-10T10:00:00Z", capacity = 3.5),
            row(orderId = 9, createdAt = "2026-11-09T10:00:00Z", capacity = 4.0),
            row(orderId = 8, createdAt = "2026-11-08T10:00:00Z", capacity = 3.5),
        )
        val result = buildPriceMemory(rows, mapOf(1 to 4.0), mapOf(1 to 3.5), 10)
        assertEquals(2, result.getValue(1).size)
        assertTrue(result.getValue(1).all { it.litres == 3.5 })
    }

    @Test
    fun `per-litre filter tolerates just under 0 05 litres of drift`() {
        val rows = listOf(
            row(orderId = 10, createdAt = "2026-11-10T10:00:00Z", capacity = 3.54),
            row(orderId = 9, createdAt = "2026-11-09T10:00:00Z", capacity = 3.56),
        )
        val result = buildPriceMemory(rows, mapOf(1 to 4.0), mapOf(1 to 3.5), 10)
        assertEquals(listOf(3.54), result.getValue(1).map { it.litres })
    }

    @Test
    fun `zero capacity falls back to the pack size, unknown product to zero`() {
        val rows = listOf(
            row(orderId = 10, capacity = 0.0),
            row(refId = 2, orderId = 11, capacity = 0.0),
        )
        val result = buildPriceMemory(rows, mapOf(1 to 4.0), emptyMap(), 10)
        assertEquals(4.0, result.getValue(1)[0].litres, 0.0)
        assertEquals(0.0, result.getValue(2)[0].litres, 0.0)
    }

    @Test
    fun `prorated flag follows billed_by_capacity and date is the order date`() {
        val rows = listOf(
            row(billedByCapacity = true, createdAt = "2026-11-10T10:00:00Z"),
            row(orderId = 9, billedByCapacity = false, createdAt = "2026-11-09T10:00:00Z"),
        )
        val result = buildPriceMemory(rows, mapOf(1 to 4.0), emptyMap(), 10)
        val entries = result.getValue(1)
        assertTrue(entries[0].prorated)
        assertTrue(!entries[1].prorated)
        assertEquals("2026-11-10T10:00:00Z", entries[0].date)
        assertEquals(1, entries[0].productId)
        assertEquals(1.0, entries[0].qty, 0.0)
    }

    @Test
    fun `rows are grouped per product`() {
        val rows = listOf(
            row(refId = 1, orderId = 10),
            row(refId = 2, orderId = 11),
        )
        val result = buildPriceMemory(rows, mapOf(1 to 4.0, 2 to 4.0), emptyMap(), 10)
        assertEquals(setOf(1, 2), result.keys)
    }

    // NOTE: voided orders are excluded by the DAO query itself, which
    // filters orders to status='completed' — that is a DAO concern, not
    // this builder's, so it is not tested here.
}
