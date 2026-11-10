package app.lubric.desktop

import app.lubric.desktop.data.db.ExpenseEntity
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.db.PurchaseOrderEntity
import app.lubric.desktop.data.db.VendorPayableEntity
import app.lubric.desktop.data.pricing.round2
import app.lubric.desktop.data.reports.PnlKindRow
import app.lubric.desktop.data.reports.ReportPeriod
import app.lubric.desktop.data.reports.computePnl
import app.lubric.desktop.data.reports.computeReportTotals
import app.lubric.desktop.data.reports.margin
import app.lubric.desktop.data.reports.pct
import app.lubric.desktop.data.reports.periodRange
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM tests for the Reports + P&L maths. No Room/Android classes are
 * touched — entities are fabricated, and the DAO's range filtering is
 * covered at the boundary-contract level (periodRange's half-open dates).
 */
class PnlCalculationTest {

    private fun order(
        id: Long = 1,
        total: Double? = 1000.0,
        paid: Double? = 1000.0,
        status: String = "completed",
        createdAt: String? = "2026-11-11T10:00:00",
    ) = OrderEntity(
        id = id, total = total, paidAmount = paid, status = status, createdAt = createdAt,
    )

    private fun expense(amount: Double? = 100.0) = ExpenseEntity(amount = amount)

    private fun purchaseOrder(total: Double? = 500.0, status: String = "received") =
        PurchaseOrderEntity(total = total, status = status)

    private fun payable(amount: Double? = 200.0, status: String = "pending") =
        VendorPayableEntity(amount = amount, status = status)

    // -- revenue: only completed orders count --------------------------------

    @Test
    fun `revenue excludes draft cancelled and returned orders`() {
        val totals = computeReportTotals(
            orders = listOf(
                order(id = 1, total = 1000.0, paid = 800.0, status = "completed"),
                order(id = 2, total = 500.0, paid = 500.0, status = "draft"),
                order(id = 3, total = 700.0, paid = 0.0, status = "cancelled"),
                order(id = 4, total = 300.0, paid = 300.0, status = "returned"),
            ),
            expenses = emptyList(),
            purchaseOrders = emptyList(),
            openPayables = emptyList(),
        )
        assertEquals(1000.0, totals.revenue, 0.0)
        assertEquals(800.0, totals.collected, 0.0)
        assertEquals(200.0, totals.remaining, 0.0)
        assertEquals(1, totals.bills)
    }

    @Test
    fun `refunds are cancelled and void orders only, and reduce net sales`() {
        val pnl = computePnl(
            orders = listOf(
                order(id = 1, total = 1000.0, status = "completed"),
                order(id = 2, total = 200.0, status = "cancelled"),
                order(id = 3, total = 50.0, status = "void"),
                // 'returned' is a valid order status but NOT a refund in pnl.ts.
                order(id = 4, total = 300.0, status = "returned"),
                order(id = 5, total = 400.0, status = "draft"),
            ),
            expenses = emptyList(),
            purchaseOrders = emptyList(),
        )
        assertEquals(1000.0, pnl.totalSales, 0.0)
        assertEquals(250.0, pnl.refunds, 0.0)
        assertEquals(0.0, pnl.discounts, 0.0)
        assertEquals(750.0, pnl.netSales, 0.0)
    }

    // -- expenses + profit arithmetic ----------------------------------------

    @Test
    fun `expenses sum and profit is revenue minus expenses`() {
        val totals = computeReportTotals(
            orders = listOf(order(total = 1000.0, paid = 1000.0)),
            expenses = listOf(expense(150.0), expense(50.5), expense(null)),
            purchaseOrders = emptyList(),
            openPayables = emptyList(),
        )
        assertEquals(200.5, totals.expenses, 0.0)
        assertEquals(799.5, totals.profit, 0.0)
    }

    @Test
    fun `gross and net profit subtract product cost and shop expenses`() {
        val pnl = computePnl(
            orders = listOf(order(total = 1000.0)),
            expenses = listOf(expense(100.0)),
            purchaseOrders = emptyList(),
            kindRows = listOf(
                PnlKindRow(kind = "product", sales = 700.0, cost = 400.0),
                // Service cost is a structural zero on the web (no cost
                // column); the join only ever matches products.
                PnlKindRow(kind = "service", sales = 300.0, cost = 0.0),
            ),
        )
        assertEquals(700.0, pnl.productSales, 0.0)
        assertEquals(400.0, pnl.productCost, 0.0)
        assertEquals(300.0, pnl.serviceSales, 0.0)
        assertEquals(0.0, pnl.serviceCost, 0.0)
        assertEquals(600.0, pnl.grossProfit, 0.0)
        assertEquals(60.0, pnl.grossMargin!!, 0.0)
        assertEquals(500.0, pnl.netProfit, 0.0)
        assertEquals(50.0, pnl.netMargin!!, 0.0)
        assertEquals("50.0%", pct(pnl.netMargin))
    }

    @Test
    fun `margins are null with no net sales`() {
        val pnl = computePnl(
            orders = emptyList(),
            expenses = listOf(expense(10.0)),
            purchaseOrders = emptyList(),
        )
        assertNull(pnl.grossMargin)
        assertNull(pnl.netMargin)
        assertEquals("—", pct(pnl.netMargin))
        assertEquals(-10.0, pnl.netProfit, 0.0)
        assertNull(margin(5.0, 0.0))
    }

    // -- purchases + open payables -------------------------------------------

    @Test
    fun `purchases count received orders only and never reduce profit`() {
        val totals = computeReportTotals(
            orders = listOf(order(total = 1000.0)),
            expenses = emptyList(),
            purchaseOrders = listOf(
                purchaseOrder(total = 500.0, status = "received"),
                purchaseOrder(total = 900.0, status = "draft"),
                purchaseOrder(total = 700.0, status = "cancelled"),
            ),
            openPayables = emptyList(),
        )
        assertEquals(500.0, totals.purchases, 0.0)
        // Web P&L: purchase orders never enter profit (cost enters as COGS).
        assertEquals(1000.0, totals.profit, 0.0)
        val pnl = computePnl(
            orders = listOf(order(total = 1000.0)),
            expenses = emptyList(),
            purchaseOrders = listOf(purchaseOrder(total = 500.0, status = "received")),
        )
        assertEquals(500.0, pnl.purchasesTotal, 0.0)
        assertEquals(1000.0, pnl.netProfit, 0.0)
    }

    @Test
    fun `open payables sum pending and partial, never paid`() {
        val totals = computeReportTotals(
            orders = emptyList(),
            expenses = emptyList(),
            purchaseOrders = emptyList(),
            openPayables = listOf(
                payable(amount = 200.0, status = "pending"),
                payable(amount = 150.0, status = "partial"),
                payable(amount = 999.0, status = "paid"),
            ),
        )
        assertEquals(350.0, totals.openPayables, 0.0)
        assertEquals(2, totals.openPayableCount)
    }

    // -- round2 at the same points as the web --------------------------------

    @Test
    fun `round2 is applied once per total, not per row`() {
        // 0.1 + 0.2 in doubles is 0.30000000000000004; the web displays
        // 0.30 because it rounds the total, and so do we.
        val totals = computeReportTotals(
            orders = listOf(
                order(id = 1, total = 0.1, paid = 0.1),
                order(id = 2, total = 0.2, paid = 0.2),
            ),
            expenses = emptyList(),
            purchaseOrders = emptyList(),
            openPayables = emptyList(),
        )
        assertEquals(0.3, totals.revenue, 0.0)
        assertEquals(0.3, totals.collected, 0.0)
        // Ties round up, like JS Math.round (Pricing.kt round2).
        assertEquals(0.13, round2(0.125), 0.0)
    }

    // -- period ranges + boundary contract -----------------------------------

    @Test
    fun `periodRange matches the web periods`() {
        val now = LocalDate.of(2026, 11, 11) // a Wednesday
        assertEquals("2026-11-11" to "2026-11-12", periodRange(ReportPeriod.TODAY, now))
        // Rolling 7 days: today minus 6.
        assertEquals("2026-11-05" to "2026-11-12", periodRange(ReportPeriod.WEEK, now))
        assertEquals("2026-11-01" to "2026-11-12", periodRange(ReportPeriod.MONTH, now))
        assertEquals("2026-10-12" to "2026-11-12", periodRange(ReportPeriod.LAST_30_DAYS, now))
        assertEquals("2026-01-01" to "2026-11-12", periodRange(ReportPeriod.YEAR, now))
        assertEquals("1900-01-01" to "3000-01-01", periodRange(ReportPeriod.ALL, now))
        assertEquals(
            "2026-10-01" to "2026-10-31",
            periodRange(ReportPeriod.CUSTOM, now, "2026-10-01", "2026-10-30"),
        )
        // Custom with no dates falls back to all-time start / today.
        assertEquals("1900-01-01" to "2026-11-12", periodRange(ReportPeriod.CUSTOM, now))
    }

    @Test
    fun `period boundaries include the range start and exclude the range end`() {
        // The DAO compares created_at >= :from AND created_at < :to on ISO
        // text; an order stamped exactly at the start is in, one stamped
        // exactly at the end is out — for both timestamp spellings.
        val (from, to) = periodRange(ReportPeriod.TODAY, LocalDate.of(2026, 11, 11))
        assertEquals("2026-11-11", from)
        assertEquals("2026-11-12", to)
        for (atStart in listOf("2026-11-11T00:00:00", "2026-11-11 00:00:00", "2026-11-11")) {
            assertTrue("$atStart should be in range", atStart >= from && atStart < to)
        }
        for (atEnd in listOf("2026-11-12T00:00:00", "2026-11-12 00:00:00", "2026-11-12")) {
            assertTrue("$atEnd should be out of range", !(atEnd >= from && atEnd < to))
        }
        // A late-night order on the last day is still in.
        assertTrue("2026-11-11T23:59:59" >= from && "2026-11-11T23:59:59" < to)
        assertTrue("2026-11-11 23:59:59" >= from && "2026-11-11 23:59:59" < to)
    }
}
