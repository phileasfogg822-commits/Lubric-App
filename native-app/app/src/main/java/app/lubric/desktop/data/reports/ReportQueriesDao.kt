package app.lubric.desktop.data.reports

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.ExpenseEntity
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.db.PurchaseOrderEntity
import app.lubric.desktop.data.db.VendorPayableEntity

/**
 * Read-only range queries for Reports + Profit & Loss. Table/column names
 * are copied exactly from `data/db/EntitiesCore.kt` (Room SQL is only
 * validated by CI/KSP, so a wrong column name fails the build there).
 *
 * Range convention (matches [periodRange]): [from] is the inclusive ISO
 * *date* and [to] is the exclusive ISO *date* (the day after the web's
 * inclusive `to`). All comparisons are `created_at >= :from AND
 * created_at < :to` on ISO text. Bare date bounds stay correct for both
 * timestamp spellings the local DB holds (`YYYY-MM-DD HH:MM:SS` from
 * SQLite `datetime('now')` and `YYYY-MM-DDTHH:MM:SS` from the server).
 *
 * Two expense queries exist on purpose — the web uses two different date
 * rules: Reports SummaryTab filters on `date(e.created_at)`
 * ([expensesInRange]), while P&L filters on
 * `COALESCE(NULLIF(date, ''), created_at)` — the expense's own `date`
 * column when set, else `created_at` ([expensesEffectiveInRange],
 * ProfitLoss.tsx expenses query). A backdated expense (date ≠ created_at)
 * therefore lands in different periods on the two screens, exactly as on
 * the web.
 */
@Dao
interface ReportQueriesDao {

    /** Completed orders in the range (Reports SummaryTab + P&L revenue). */
    @Query(
        "SELECT * FROM orders WHERE shop_id = :shopId AND status = 'completed' " +
            "AND created_at >= :from AND created_at < :to ORDER BY created_at, id",
    )
    suspend fun completedOrdersInRange(shopId: Int, from: String, to: String): List<OrderEntity>

    /**
     * All orders in the range, any status — the P&L also needs cancelled /
     * void orders for refunds (`pnl.ts`: refunds = cancelled + void totals),
     * and the report calculator splits completed from the rest itself.
     */
    @Query(
        "SELECT * FROM orders WHERE shop_id = :shopId " +
            "AND created_at >= :from AND created_at < :to ORDER BY created_at, id",
    )
    suspend fun ordersInRange(shopId: Int, from: String, to: String): List<OrderEntity>

    /** Completed-order count in the range. */
    @Query(
        "SELECT COUNT(*) FROM orders WHERE shop_id = :shopId AND status = 'completed' " +
            "AND created_at >= :from AND created_at < :to",
    )
    suspend fun completedOrderCountInRange(shopId: Int, from: String, to: String): Int

    /** Expenses in the range by created_at (Reports SummaryTab rule). */
    @Query(
        "SELECT * FROM expenses WHERE shop_id = :shopId " +
            "AND created_at >= :from AND created_at < :to ORDER BY created_at, id",
    )
    suspend fun expensesInRange(shopId: Int, from: String, to: String): List<ExpenseEntity>

    /** Expenses in the range by effective date (P&L rule, see class doc). */
    @Query(
        "SELECT * FROM expenses WHERE shop_id = :shopId " +
            "AND COALESCE(NULLIF(date, ''), created_at) >= :from " +
            "AND COALESCE(NULLIF(date, ''), created_at) < :to ORDER BY created_at, id",
    )
    suspend fun expensesEffectiveInRange(shopId: Int, from: String, to: String): List<ExpenseEntity>

    /** Purchase orders in the range, any status (calculator keeps 'received'). */
    @Query(
        "SELECT * FROM purchase_orders WHERE shop_id = :shopId " +
            "AND created_at >= :from AND created_at < :to ORDER BY created_at, id",
    )
    suspend fun purchaseOrdersInRange(shopId: Int, from: String, to: String): List<PurchaseOrderEntity>

    /**
     * Per-kind sales + cost over completed orders, verbatim from
     * ProfitLoss.tsx: sales = SUM(line_total); cost =
     * SUM(qty × COALESCE(products.cost_price, 0)) with the product join
     * restricted to kind='product', so the service row's cost is always 0.
     */
    @Query(
        "SELECT oi.kind AS kind, COALESCE(SUM(oi.line_total), 0) AS sales, " +
            "COALESCE(SUM(oi.qty * COALESCE(p.cost_price, 0)), 0) AS cost " +
            "FROM orders o JOIN order_items oi ON oi.order_id = o.id " +
            "LEFT JOIN products p ON p.id = oi.ref_id AND oi.kind = 'product' " +
            "WHERE o.shop_id = :shopId AND o.status = 'completed' " +
            "AND o.created_at >= :from AND o.created_at < :to GROUP BY oi.kind",
    )
    suspend fun pnlKindRows(shopId: Int, from: String, to: String): List<PnlKindRow>

    /**
     * Open vendor payables, all time (no date range — outstanding is a
     * current-state figure, as in the web's open-payables query,
     * `src/lib/ledgerSql.ts:164`: status IN ('pending','partial')).
     */
    @Query(
        "SELECT * FROM vendor_payables WHERE shop_id = :shopId " +
            "AND status IN ('pending', 'partial') ORDER BY due_date, id",
    )
    suspend fun openVendorPayables(shopId: Int): List<VendorPayableEntity>
}
