package app.lubric.desktop.data.reports

import app.lubric.desktop.data.db.ExpenseEntity
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.db.PurchaseOrderEntity
import app.lubric.desktop.data.db.VendorPayableEntity
import app.lubric.desktop.data.pricing.round2
import java.time.LocalDate

/**
 * Pure Reports + Profit & Loss maths — no Room/Android imports, only entity
 * types cross the boundary, so unit tests run on the JVM.
 *
 * Web sources (reproduced literally; see the per-formula comments):
 * - `src/modules/profit/pnl.ts` — [computePnl], [periodRange], [margin], [pct].
 * - `src/modules/profit/ProfitLoss.tsx` — the three SQL statements that feed
 *   [computePnl] (kind rows, sales/refunds, expenses).
 * - `src/modules/reports/Reports.tsx` — SummaryTab (revenue/collected/
 *   remaining/outgoing/profit), StatementTab + CompareTab vendor scope
 *   (purchase_orders `status='received'`), and the vendor open-payables
 *   rule in `src/lib/ledgerSql.ts:164` (`status IN ('pending','partial')`).
 *
 * Rounding: the web's `pnl.ts` does plain double arithmetic on SQL SUMs
 * (the server sums NUMERIC exactly; the client only formats at display).
 * The native sums run in Kotlin over Doubles, so each total is passed once
 * through [round2] (JS `Math.round` semantics, ties up) at the same point
 * the web would display it — never per row, never accumulated unrounded
 * across many operations (survey §8.2).
 *
 * Dates: the web's periods are inclusive calendar-date windows
 * (`created_at::date BETWEEN $1 AND $2`). [periodRange] returns the
 * equivalent half-open ISO *date* pair `(from, toExclusive)` — `to` is the
 * day after the web's inclusive `to` — so the DAO's
 * `created_at >= :from AND created_at < :to` text comparison matches the
 * web window exactly. Bare date bounds also stay correct for both timestamp
 * spellings the local DB holds (`YYYY-MM-DD HH:MM:SS` from SQLite
 * `datetime('now')` and `YYYY-MM-DDTHH:MM:SS` from the server): any
 * timestamp on the `from` date is >= the bare date string, and any
 * timestamp before the `to` date is < the bare `to` string.
 */

/** One aggregated row per order-item kind, exactly as the web P&L fetches it. */
data class PnlKindRow(
    val kind: String,
    val sales: Double,
    val cost: Double,
)

/** Period chips. Labels match `pnl.ts` PERIODS, plus LAST_30_DAYS. */
enum class ReportPeriod(val label: String) {
    TODAY("Today"),
    WEEK("This Week"),
    MONTH("This Month"),
    /** Not a P&L chip in pnl.ts — it is the Reports SummaryTab default range. */
    LAST_30_DAYS("Last 30 Days"),
    YEAR("This Year"),
    ALL("All Time"),
    CUSTOM("Custom Range"),
}

/** Sentinels so "All Time" reuses the same range shape (`pnl.ts`). */
const val MIN_DATE = "1900-01-01"
const val MAX_DATE = "2999-12-31"

/** Day after an ISO date string; returns the input unchanged if unparsable. */
fun nextDay(isoDate: String): String = try {
    LocalDate.parse(isoDate).plusDays(1).toString()
} catch (_: Exception) {
    isoDate
}

/**
 * Inclusive web window `[from, to]` as the half-open ISO-date pair
 * `(from, toExclusive)` the DAO compares against.
 * `pnl.ts periodRange`: today = today; week = rolling 7 days (today − 6);
 * month = 1st of the month; year = 1 Jan; all = 1900-01-01 → 2999-12-31;
 * custom = supplied dates, defaulting to MIN_DATE / today.
 */
fun periodRange(
    period: ReportPeriod,
    now: LocalDate,
    customFrom: String? = null,
    customTo: String? = null,
): Pair<String, String> {
    val today = now.toString()
    return when (period) {
        ReportPeriod.TODAY -> today to nextDay(today)
        ReportPeriod.WEEK -> now.minusDays(6).toString() to nextDay(today)
        ReportPeriod.MONTH -> LocalDate.of(now.year, now.monthValue, 1).toString() to nextDay(today)
        ReportPeriod.LAST_30_DAYS -> now.minusDays(30).toString() to nextDay(today)
        ReportPeriod.YEAR -> LocalDate.of(now.year, 1, 1).toString() to nextDay(today)
        ReportPeriod.ALL -> MIN_DATE to nextDay(MAX_DATE)
        ReportPeriod.CUSTOM -> {
            val from = customFrom?.takeIf { it.isNotBlank() } ?: MIN_DATE
            val to = customTo?.takeIf { it.isNotBlank() } ?: today
            from to nextDay(to)
        }
    }
}

/** Percent, or null when there is no revenue to divide by (`pnl.ts margin`). */
fun margin(part: Double, base: Double): Double? {
    if (base == 0.0) return null
    return (part / base) * 100
}

/** "20.2%" — or an em dash when the base was zero (`pnl.ts pct`). */
fun pct(m: Double?): String = if (m == null) "—" else "%.1f%%".format(java.util.Locale.US, m)

/** Totals for the Reports screen (Reports.tsx SummaryTab + vendor rules). */
data class ReportTotals(
    /** Completed bills in the range. */
    val bills: Int,
    /** SUM(total) over completed orders — SummaryTab "Incoming". */
    val revenue: Double,
    /** SUM(paid_amount) over completed orders — SummaryTab "Collected". */
    val collected: Double,
    /** revenue − collected — SummaryTab "Remaining (credit)". */
    val remaining: Double,
    /** SUM(amount) over expenses — SummaryTab "Outgoing". */
    val expenses: Double,
    /** SUM(total) over `received` purchase orders only (see below). */
    val purchases: Double,
    /** SUM(amount) over open vendor payables (pending + partial). */
    val openPayables: Double,
    val openPayableCount: Int,
    /** revenue − expenses — SummaryTab "Profit". */
    val profit: Double,
)

/**
 * Reports totals. The caller passes rows already fetched for the period
 * (DAO range queries); this function only applies the web's status rules.
 *
 * - revenue/collected/bills: `orders.status='completed'` only
 *   (Reports.tsx SummaryTab `WHERE o.status='completed'`; draft/cancelled/
 *   returned orders are excluded, as are voided bills — voiding sets the
 *   order row to `'cancelled'`, `editSale.ts voidOrder`).
 * - expenses: SUM(amount) as fetched (the DAO applies the SummaryTab rule,
 *   `date(e.created_at)` in range).
 * - purchases: `purchase_orders.status='received'` only. The web never sums
 *   purchase orders anywhere except with that filter (Reports.tsx
 *   StatementTab + CompareTab vendor scope); server status CHECK is
 *   ('draft','received','cancelled') (`server/migrations/001_init.sql`),
 *   so draft/cancelled orders are excluded.
 * - openPayables: `status IN ('pending','partial')`
 *   (`src/lib/ledgerSql.ts:164`, the web's open-payables query); 'paid'
 *   rows are settled and excluded. The filter is applied in the DAO and
 *   again here, so unfiltered input still totals correctly.
 *   'partial' payable's `amount` is its original full amount — the web
 *   has no per-payable remaining-balance column — so a partially paid
 *   payable counts at its full amount here, exactly as the web's own
 *   open-payables list does.
 */
fun computeReportTotals(
    orders: List<OrderEntity>,
    expenses: List<ExpenseEntity>,
    purchaseOrders: List<PurchaseOrderEntity>,
    openPayables: List<VendorPayableEntity>,
): ReportTotals {
    val completed = orders.filter { it.status == "completed" }
    val revenue = round2(completed.sumOf { it.total ?: 0.0 })
    val collected = round2(completed.sumOf { it.paidAmount ?: 0.0 })
    val expensesTotal = round2(expenses.sumOf { it.amount ?: 0.0 })
    val purchases = round2(
        purchaseOrders.filter { it.status == "received" }.sumOf { it.total ?: 0.0 },
    )
    // Open = pending + partial (ledgerSql.ts:164); 'paid' rows are settled.
    // Filtered here as well as in the DAO, so the totals are right even if
    // a caller passes unfiltered rows.
    val open = openPayables.filter { it.status == "pending" || it.status == "partial" }
    val openTotal = round2(open.sumOf { it.amount ?: 0.0 })
    return ReportTotals(
        bills = completed.size,
        revenue = revenue,
        collected = collected,
        remaining = round2(revenue - collected),
        expenses = expensesTotal,
        purchases = purchases,
        openPayables = openTotal,
        openPayableCount = open.size,
        profit = round2(revenue - expensesTotal),
    )
}

/** Full P&L statement, mirroring the `pnl.ts` Pnl shape plus a memo line. */
data class Pnl(
    val totalSales: Double,
    val discounts: Double,
    val refunds: Double,
    val netSales: Double,
    val productSales: Double,
    val productCost: Double,
    val serviceSales: Double,
    val serviceCost: Double,
    val grossProfit: Double,
    val grossMargin: Double?,
    val shopExpenses: Double,
    val netProfit: Double,
    val netMargin: Double?,
    /**
     * Memo only: SUM(total) over `received` purchase orders in the range.
     * The web P&L never queries purchase_orders — purchases are stock, and
     * their cost reaches profit only as COGS ([productCost], from
     * `products.cost_price` × qty sold). Shown on screen as a memo, never
     * subtracted from profit.
     */
    val purchasesTotal: Double,
)

/**
 * P&L, implementing `pnl.ts computePnl` literally.
 *
 * - totalSales = SUM(total) over completed orders (ProfitLoss.tsx sales
 *   query: `SUM(total) FILTER (WHERE status = 'completed')`).
 * - refunds = SUM(total) over orders with status IN ('cancelled','void')
 *   (same query). NOTE: 'returned' orders are NOT refunds in the web
 *   formula, even though 'returned' is a valid order status; and 'void'
 *   is counted although it is not in the orders status CHECK.
 * - discounts = 0 always — structural zero: `orders` has no discount
 *   column (`pnl.ts` header comment).
 * - netSales = totalSales − discounts − refunds.
 * - productSales/serviceSales/productCost/serviceCost come from [kindRows]:
 *   per-kind SUM(line_total) and SUM(qty × COALESCE(products.cost_price,0))
 *   over completed orders (ProfitLoss.tsx kinds query). The LEFT JOIN only
 *   matches products when `oi.kind = 'product'`, so serviceCost is ALWAYS
 *   0 — structural zero: `services` has no cost column (`pnl.ts` header
 *   comment). Kinds other than product/service (partial_container,
 *   used_oil) are fetched by the web query but ignored by `computePnl`,
 *   so their sales sit in totalSales/netSales but in neither breakdown.
 * - grossProfit = netSales − productCost − serviceCost;
 *   grossMargin = grossProfit / netSales (null when netSales is 0).
 * - shopExpenses = SUM(expenses.amount) as fetched (the DAO applies the
 *   web rule: `COALESCE(NULLIF(date,''), created_at)` in range).
 * - netProfit = grossProfit − shopExpenses;
 *   netMargin = netProfit / netSales (null when netSales is 0).
 */
fun computePnl(
    orders: List<OrderEntity>,
    expenses: List<ExpenseEntity>,
    purchaseOrders: List<PurchaseOrderEntity>,
    kindRows: List<PnlKindRow> = emptyList(),
): Pnl {
    val totalSales = round2(
        orders.filter { it.status == "completed" }.sumOf { it.total ?: 0.0 },
    )
    val refunds = round2(
        orders.filter { it.status == "cancelled" || it.status == "void" }
            .sumOf { it.total ?: 0.0 },
    )
    val discounts = 0.0
    val netSales = round2(totalSales - discounts - refunds)
    val product = kindRows.find { it.kind == "product" }
    val service = kindRows.find { it.kind == "service" }
    val productSales = round2(product?.sales ?: 0.0)
    val productCost = round2(product?.cost ?: 0.0)
    val serviceSales = round2(service?.sales ?: 0.0)
    val serviceCost = round2(service?.cost ?: 0.0)
    val grossProfit = round2(netSales - productCost - serviceCost)
    val shopExpenses = round2(expenses.sumOf { it.amount ?: 0.0 })
    val netProfit = round2(grossProfit - shopExpenses)
    return Pnl(
        totalSales = totalSales,
        discounts = discounts,
        refunds = refunds,
        netSales = netSales,
        productSales = productSales,
        productCost = productCost,
        serviceSales = serviceSales,
        serviceCost = serviceCost,
        grossProfit = grossProfit,
        grossMargin = margin(grossProfit, netSales),
        shopExpenses = shopExpenses,
        netProfit = netProfit,
        netMargin = margin(netProfit, netSales),
        purchasesTotal = round2(
            purchaseOrders.filter { it.status == "received" }.sumOf { it.total ?: 0.0 },
        ),
    )
}
