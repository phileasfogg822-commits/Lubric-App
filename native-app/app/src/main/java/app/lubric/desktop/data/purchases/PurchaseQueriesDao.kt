package app.lubric.desktop.data.purchases

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.PurchaseOrderEntity
import app.lubric.desktop.data.db.PurchaseOrderItemEntity

/**
 * Read queries for purchase orders.
 *
 * The web app has no purchase screen (src/modules/purchase/Purchase.tsx is
 * a "coming soon" stub); the behaviour reproduced here comes from the schema
 * (src/lib/localDb.ts), the sales-history/reports queries that read
 * purchase_orders (status 'received', draft → received on stock-in), and
 * src/lib/stock.ts (receiving is a stockIn: stock_movements kind
 * 'purchase' + products.stock_qty += qty + stock_levels upsert).
 *
 * NOTE FOR THE COORDINATOR: this DAO is not yet registered on
 * [app.lubric.desktop.data.db.LubricDatabase] (that file is owned by the
 * coordinator) — add `abstract fun purchaseQueriesDao(): PurchaseQueriesDao`
 * there. Until then [PurchaseRepository] reads through the existing DAOs
 * plus raw queries on `db.openHelper`, so this interface is compiled but
 * not yet called at runtime.
 */
@Dao
interface PurchaseQueriesDao {

    @Query("SELECT * FROM purchase_orders ORDER BY created_at DESC")
    suspend fun listAll(): List<PurchaseOrderEntity>

    @Query(
        "SELECT * FROM purchase_orders WHERE vendor_id = :vendorId " +
            "ORDER BY created_at DESC",
    )
    suspend fun byVendor(vendorId: Int): List<PurchaseOrderEntity>

    @Query(
        "SELECT * FROM purchase_orders WHERE status = :status " +
            "ORDER BY created_at DESC",
    )
    suspend fun byStatus(status: String): List<PurchaseOrderEntity>

    @Query("SELECT * FROM purchase_orders WHERE id = :id LIMIT 1")
    suspend fun getById(id: Long): PurchaseOrderEntity?

    @Query(
        "SELECT * FROM purchase_order_items WHERE order_id = :orderId " +
            "ORDER BY id",
    )
    suspend fun itemsByOrder(orderId: Int): List<PurchaseOrderItemEntity>
}
