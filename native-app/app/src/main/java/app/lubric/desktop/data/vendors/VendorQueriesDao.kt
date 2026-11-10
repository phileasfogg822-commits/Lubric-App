package app.lubric.desktop.data.vendors

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.VendorEntity
import app.lubric.desktop.data.db.VendorPayableEntity

/**
 * Read queries for vendors and their payables, mirroring the web app
 * (`src/modules/vendors/Vendors.tsx`, `src/lib/ledgerSql.ts`
 * `openPayablesQuery`).
 *
 * WIRING NOTE: this DAO is deliberately NOT referenced from
 * [app.lubric.desktop.data.db.LubricDatabase] yet — that file is owned by
 * the coordinator. To wire it, add one line there:
 * `abstract fun vendorQueriesDao(): VendorQueriesDao`.
 * Until then the repositories in this package read the same rows through
 * the existing DAOs plus the raw-query helpers in [VendorRepository] /
 * [app.lubric.desktop.data.ledger.LedgerRepository], using the same SQL
 * written here, so nothing in this package depends on the wiring landing.
 *
 * Soft-deleted vendors (`deleted_at` set) are excluded from the list and
 * search queries: the web list SQL has no `deleted_at` filter, but without
 * the filter a soft delete would be invisible in the UI.
 */
@Dao
interface VendorQueriesDao {

    /** All vendors, name order, soft-deleted rows excluded. */
    @Query("SELECT * FROM vendors WHERE deleted_at IS NULL ORDER BY name")
    suspend fun listVendors(): List<VendorEntity>

    /** Vendors whose name or phone contains [q] (case-insensitive LIKE). */
    @Query(
        "SELECT * FROM vendors WHERE deleted_at IS NULL AND " +
            "(name LIKE '%' || :q || '%' OR phone LIKE '%' || :q || '%') " +
            "ORDER BY name",
    )
    suspend fun searchVendors(q: String): List<VendorEntity>

    /** Every payable for one vendor, oldest due first (null due dates last). */
    @Query(
        "SELECT * FROM vendor_payables WHERE vendor_id = :vendorId " +
            "ORDER BY (due_date IS NULL), due_date, id",
    )
    suspend fun payablesByVendor(vendorId: Long): List<VendorPayableEntity>

    @Query("SELECT * FROM vendor_payables WHERE id = :id LIMIT 1")
    suspend fun payableById(id: Long): VendorPayableEntity?

    /** Ledger-derived balance: SUM(debit) - SUM(credit); positive = we owe them. */
    @Query(
        "SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount " +
            "ELSE -amount END), 0) FROM party_ledger " +
            "WHERE party_type = 'vendor' AND party_id = :vendorId",
    )
    suspend fun vendorBalance(vendorId: Long): Double

    /** Open payables (pending/partial), oldest due first. */
    @Query(
        "SELECT * FROM vendor_payables WHERE vendor_id = :vendorId " +
            "AND status IN ('pending', 'partial') " +
            "ORDER BY (due_date IS NULL), due_date, id",
    )
    suspend fun openPayables(vendorId: Long): List<VendorPayableEntity>

    /**
     * Open payables with what [app.lubric.desktop.data.db.PayableAllocationEntity]
     * rows have already settled against each one — the FIFO input for
     * `allocatePayables`. "Settled" comes from payable_allocations, NOT from
     * the ledger (web `openPayablesQuery`): one payment can cover several
     * invoices, so it cannot be read off party_ledger per payable.
     */
    @Query(
        "SELECT vp.id, vp.amount, " +
            "COALESCE((SELECT SUM(a.amount) FROM payable_allocations a " +
            "WHERE a.vendor_payable_id = vp.id), 0) AS settled " +
            "FROM vendor_payables vp " +
            "WHERE vp.vendor_id = :vendorId AND vp.status IN ('pending', 'partial') " +
            "ORDER BY (vp.due_date IS NULL), vp.due_date, vp.id",
    )
    suspend fun openPayablesWithSettled(vendorId: Long): List<OpenPayableRow>
}

/**
 * One open payable plus what has already been allocated against it.
 * `settled` is 0 when no allocation row exists yet.
 */
data class OpenPayableRow(
    @ColumnInfo(name = "id") val id: Long,
    @ColumnInfo(name = "amount") val amount: Double?,
    @ColumnInfo(name = "settled") val settled: Double,
)
