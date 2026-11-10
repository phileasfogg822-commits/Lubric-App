package app.lubric.desktop

import app.lubric.desktop.data.purchases.PurchaseLineInput
import app.lubric.desktop.data.purchases.canCancelPurchaseOrder
import app.lubric.desktop.data.purchases.canReceivePurchaseOrder
import app.lubric.desktop.data.purchases.newStockLevelQty
import app.lubric.desktop.data.purchases.purchaseLineTotal
import app.lubric.desktop.data.purchases.purchaseOrderTotal
import app.lubric.desktop.data.purchases.receiveQtyAfter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM tests for the receive maths and state rules used by
 * [app.lubric.desktop.data.purchases.PurchaseRepository]: no Room, no
 * Android classes — only the pure helpers.
 */
class PurchaseReceiveTest {

    private val lines = listOf(
        PurchaseLineInput(productId = 1, productName = "Engine Oil 4L", qty = 2.0, unitCost = 100.5),
        PurchaseLineInput(productId = 2, productName = "Filter", qty = 3.0, unitCost = 49.99),
    )

    @Test
    fun `order total is the rounded sum of rounded line totals`() {
        assertEquals(201.0, purchaseLineTotal(2.0, 100.5), 0.0)
        assertEquals(149.97, purchaseLineTotal(3.0, 49.99), 0.0)
        assertEquals(350.97, purchaseOrderTotal(lines), 0.0)
    }

    @Test
    fun `line total rounds half up like JS Math round`() {
        // 3 x 33.335 = 100.005 -> 100.01 (ties round UP, not to even).
        assertEquals(100.01, purchaseLineTotal(3.0, 33.335), 0.0)
    }

    @Test
    fun `empty order totals zero`() {
        assertEquals(0.0, purchaseOrderTotal(emptyList()), 0.0)
    }

    @Test
    fun `receive qty_after is current stock plus received qty`() {
        assertEquals(15.0, receiveQtyAfter(10.0, 5.0), 0.0)
        assertEquals(10.0, receiveQtyAfter(10.0, 0.0), 0.0)
        // stockIn takes the absolute value: a negative qty still adds.
        assertEquals(15.0, receiveQtyAfter(10.0, -5.0), 0.0)
    }

    @Test
    fun `stock level upsert adds onto the existing level or starts from zero`() {
        assertEquals(10.0, newStockLevelQty(7.5, 2.5), 0.0)
        assertEquals(3.0, newStockLevelQty(null, 3.0), 0.0)
        assertEquals(12.0, newStockLevelQty(7.0, -5.0), 0.0)
    }

    @Test
    fun `only a draft order can be received or cancelled`() {
        assertTrue(canReceivePurchaseOrder("draft"))
        assertTrue(canCancelPurchaseOrder("draft"))
        assertFalse(canReceivePurchaseOrder("received"))
        assertFalse(canCancelPurchaseOrder("received"))
        assertFalse(canReceivePurchaseOrder("cancelled"))
        assertFalse(canCancelPurchaseOrder("cancelled"))
    }
}
