package app.lubric.desktop.data.reports

import app.lubric.desktop.data.db.LubricDatabase
import java.time.LocalDate

/**
 * Reports + P&L repository: read-only. Resolves the period to the DAO's
 * half-open ISO-date range via [periodRange], fetches the range rows, and
 * runs them through the pure calculator functions.
 *
 * Shop scoping is applied at the call site: every fetch passes [shopId]
 * through to the DAO. No writes happen here.
 *
 * WIRING NOTE (coordinator): [LubricDatabase] does not yet expose this
 * package's DAO — add one line to `LubricDatabase.kt`:
 * `abstract fun reportQueriesDao(): ReportQueriesDao`. Until then this
 * file references a not-yet-existing accessor and will not compile.
 */
class ReportRepository(private val db: LubricDatabase) {

    private val dao get() = db.reportQueriesDao()

    /** Reports totals for [period] (default "now" is today, local date). */
    suspend fun report(
        period: ReportPeriod,
        shopId: Int,
        customFrom: String? = null,
        customTo: String? = null,
        now: LocalDate = LocalDate.now(),
    ): ReportTotals {
        val (from, to) = periodRange(period, now, customFrom, customTo)
        return computeReportTotals(
            orders = dao.ordersInRange(shopId, from, to),
            expenses = dao.expensesInRange(shopId, from, to),
            purchaseOrders = dao.purchaseOrdersInRange(shopId, from, to),
            openPayables = dao.openVendorPayables(shopId),
        )
    }

    /** P&L statement for [period] (default "now" is today, local date). */
    suspend fun pnl(
        period: ReportPeriod,
        shopId: Int,
        customFrom: String? = null,
        customTo: String? = null,
        now: LocalDate = LocalDate.now(),
    ): Pnl {
        val (from, to) = periodRange(period, now, customFrom, customTo)
        return computePnl(
            orders = dao.ordersInRange(shopId, from, to),
            expenses = dao.expensesEffectiveInRange(shopId, from, to),
            purchaseOrders = dao.purchaseOrdersInRange(shopId, from, to),
            kindRows = dao.pnlKindRows(shopId, from, to),
        )
    }

    /** Completed-order count for [period], without fetching the rows. */
    suspend fun completedOrderCount(
        period: ReportPeriod,
        shopId: Int,
        customFrom: String? = null,
        customTo: String? = null,
        now: LocalDate = LocalDate.now(),
    ): Int {
        val (from, to) = periodRange(period, now, customFrom, customTo)
        return dao.completedOrderCountInRange(shopId, from, to)
    }
}
