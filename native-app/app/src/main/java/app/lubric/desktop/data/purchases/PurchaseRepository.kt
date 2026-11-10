package app.lubric.desktop.data.purchases

import androidx.room.withTransaction
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.ProductEntity
import app.lubric.desktop.data.db.PurchaseOrderEntity
import app.lubric.desktop.data.db.PurchaseOrderItemEntity
import app.lubric.desktop.data.db.StockLevelEntity
import app.lubric.desktop.data.db.StockMovementEntity
import app.lubric.desktop.data.db.VendorEntity
import app.lubric.desktop.data.pricing.round2
import java.time.Instant
import java.util.UUID
import kotlin.math.abs

/**
 * One purchase-order line as typed into the create form. The item table
 * ([PurchaseOrderItemEntity]) stores the product by NAME only — it has no
 * product_id column — so the name is what is stored, and receive resolves
 * it back to a product by exact (case-insensitive) name match.
 */
data class PurchaseLineInput(
    val productId: Int,
    val productName: String,
    val qty: Double,
    val unitCost: Double,
)

/** One order with its lines and the vendor's display name. */
data class PurchaseOrderDetail(
    val order: PurchaseOrderEntity,
    val items: List<PurchaseOrderItemEntity>,
    val vendorName: String?,
)

/** One line total, paisa-rounded (web `round2`). */
fun purchaseLineTotal(qty: Double, unitCost: Double): Double = round2(qty * unitCost)

/** Order total: paisa-rounded sum of the paisa-rounded line totals. */
fun purchaseOrderTotal(lines: List<PurchaseLineInput>): Double =
    round2(lines.sumOf { purchaseLineTotal(it.qty, it.unitCost) })

/**
 * Stock after receiving [receivedQty]: the web's `stockIn` takes the
 * absolute value, so a negative qty typed by mistake still adds stock.
 */
fun receiveQtyAfter(currentStockQty: Double, receivedQty: Double): Double =
    currentStockQty + abs(receivedQty)

/** Per-warehouse cache after receiving [receivedQty] into a level that held [existingQty] (null = no row yet). */
fun newStockLevelQty(existingQty: Double?, receivedQty: Double): Double =
    (existingQty ?: 0.0) + abs(receivedQty)

/** Only a draft order can be received (a received/cancelled one must not double-post stock). */
fun canReceivePurchaseOrder(status: String): Boolean = status == "draft"

/** Only a draft order can be cancelled; a received order's stock is already in. */
fun canCancelPurchaseOrder(status: String): Boolean = status == "draft"

/**
 * Purchase orders: create (draft), receive (stockIn per line), cancel.
 *
 * The web app has no purchase screen — the module is a "coming soon" stub —
 * so this reproduces the behaviour the rest of the web app assumes:
 * purchase_orders + purchase_order_items rows (survey §4.2/§7 row 14),
 * receiving via `stockIn` (src/lib/stock.ts §6.4: stock_movements kind
 * 'purchase' + products.stock_qty += qty + stock_levels upsert), and the
 * 'received' status the sales-history and reports queries filter on.
 * There is no web code that creates a vendor payable on receive, so this
 * does not either.
 *
 * Writes go through the existing DAO upserts, so the outbox triggers queue
 * purchase_orders / stock_movements / products rows for sync exactly as the
 * web does. purchase_order_items is NOT a synced table (no uuid, no
 * trigger) — its rows stay local, matching the web.
 *
 * List/detail reads go through [PurchaseQueriesDao], registered on
 * [LubricDatabase] by the coordinator.
 */
class PurchaseRepository(private val db: LubricDatabase) {

    // -- reads ----------------------------------------------------------

    suspend fun purchaseOrders(): List<PurchaseOrderEntity> =
        db.purchaseQueriesDao().listAll()

    suspend fun purchaseOrdersByVendor(vendorId: Int): List<PurchaseOrderEntity> =
        db.purchaseQueriesDao().byVendor(vendorId)

    suspend fun purchaseOrdersByStatus(status: String): List<PurchaseOrderEntity> =
        db.purchaseQueriesDao().byStatus(status)

    suspend fun purchaseOrderDetail(id: Long): PurchaseOrderDetail? {
        val order = db.purchaseQueriesDao().getById(id) ?: return null
        val items = db.purchaseQueriesDao().itemsByOrder(order.id.toInt())
        val vendorName = order.vendorId?.let { db.vendorDao().getById(it.toLong())?.name }
        return PurchaseOrderDetail(order, items, vendorName)
    }

    /** Vendors for the create-form picker. */
    suspend fun vendors(): List<VendorEntity> = db.vendorDao().listAll()

    /** Active products for the create-form line picker. */
    suspend fun activeProducts(): List<ProductEntity> = db.productDao().listActive()

    // -- create ---------------------------------------------------------

    /**
     * Creates a draft order with its lines and returns the order id.
     * Total is the paisa-rounded sum of the line totals.
     */
    suspend fun createPurchaseOrder(
        vendorId: Int?,
        items: List<PurchaseLineInput>,
        notes: String,
        shopId: Int,
    ): Long {
        require(vendorId != null) { "Vendor required" }
        require(items.isNotEmpty()) { "Add at least one line" }
        for (line in items) {
            require(line.qty > 0.0) { "Quantity must be more than 0 for ${line.productName}" }
            require(line.unitCost >= 0.0) { "Unit cost cannot be negative for ${line.productName}" }
        }
        val now = Instant.now().toString()
        val uuid = UUID.randomUUID().toString()
        val total = purchaseOrderTotal(items)
        var orderId = 0L
        db.withTransaction {
            db.purchaseOrderDao().upsert(
                PurchaseOrderEntity(
                    shopId = shopId,
                    vendorId = vendorId,
                    total = total,
                    paid = 0.0,
                    status = "draft",
                    notes = notes.trim(),
                    createdAt = now,
                    uuid = uuid,
                    updatedAt = now,
                ),
            )
            orderId = db.purchaseOrderDao().getByUuid(uuid)?.id
                ?: error("Purchase order not found after insert")
            for (line in items) {
                db.purchaseOrderItemDao().upsert(
                    PurchaseOrderItemEntity(
                        orderId = orderId.toInt(),
                        productName = line.productName,
                        qty = line.qty,
                        unitCost = line.unitCost,
                        lineTotal = purchaseLineTotal(line.qty, line.unitCost),
                    ),
                )
            }
        }
        return orderId
    }

    // -- receive ----------------------------------------------------------

    /**
     * Receives a draft order in ONE transaction: status → 'received', and
     * per line the web's three stock statements — a stock_movements row
     * (kind 'purchase', qty_after = current stock + qty, ref
     * purchase_orders/<id>, warehouse = the shop's default warehouse),
     * products.stock_qty += qty, and the stock_levels upsert for that
     * warehouse. A received or cancelled order cannot be received again.
     *
     * Lines resolve to products by exact product-name match (the item
     * table stores names, not ids); an unresolvable line fails the whole
     * receive rather than silently skipping stock. When the shop has no
     * default warehouse, the movement still records a null warehouse_id
     * (web behaviour) and the stock_levels upsert is skipped — the cache
     * can be rebuilt from the ledger, and a null warehouse has no
     * per-warehouse row to update (matching SaleRepository).
     */
    suspend fun receivePurchaseOrder(id: Long) {
        val now = Instant.now().toString()
        db.withTransaction {
            val order = db.purchaseQueriesDao().getById(id)
                ?: throw IllegalArgumentException("Purchase order not found")
            require(canReceivePurchaseOrder(order.status)) {
                "Only a draft purchase order can be received (status: ${order.status})"
            }
            val items = db.purchaseQueriesDao().itemsByOrder(order.id.toInt())
            require(items.isNotEmpty()) { "Purchase order has no lines to receive" }
            val shopId = order.shopId ?: 1
            val warehouseId = db.warehouseDao().defaultId(shopId)?.toInt()
            val products = db.productDao().listActive()
            // Resolve every line before writing anything, so a bad line
            // fails before any stock moves.
            val resolved = items.map { item ->
                val product = products.firstOrNull {
                    it.name.trim().equals(item.productName.trim(), ignoreCase = true)
                } ?: throw IllegalStateException(
                    "Product '${item.productName}' not found — " +
                        "cannot receive its stock. Rename the line to match a product.",
                )
                product to item
            }
            for ((product, item) in resolved) {
                val qty = abs(item.qty ?: 0.0)
                require(qty > 0.0) { "Quantity must be more than 0 for ${item.productName}" }
                val current = db.productDao().getById(product.id)
                    ?: error("Product ${product.id} not found for receive")
                val qtyAfter = receiveQtyAfter(current.stockQty ?: 0.0, qty)
                db.stockMovementDao().upsert(
                    StockMovementEntity(
                        uuid = UUID.randomUUID().toString(),
                        shopId = shopId,
                        itemId = product.id.toInt(),
                        kind = "purchase",
                        qty = qty,
                        qtyAfter = qtyAfter,
                        refTable = "purchase_orders",
                        refId = order.id.toInt(),
                        warehouseId = warehouseId,
                        note = "Purchase order #${order.id}",
                        occurredAt = now,
                        createdAt = now,
                        updatedAt = now,
                    ),
                )
                db.productDao().upsert(current.copy(stockQty = qtyAfter, updatedAt = now))
            }
            if (warehouseId != null) {
                val deltas = resolved
                    .groupBy { it.first.id.toInt() }
                    .mapValues { (_, pairs) -> pairs.sumOf { abs(it.second.qty ?: 0.0) } }
                for ((productId, delta) in deltas) {
                    val level = db.stockLevelDao().getByWarehouseAndProduct(warehouseId, productId)
                    if (level == null) {
                        db.stockLevelDao().upsert(
                            StockLevelEntity(
                                warehouseId = warehouseId,
                                productId = productId,
                                qty = delta,
                                uuid = UUID.randomUUID().toString(),
                                shopId = shopId,
                                updatedAt = now,
                            ),
                        )
                    } else {
                        db.stockLevelDao().upsert(
                            level.copy(
                                qty = newStockLevelQty(level.qty, delta),
                                updatedAt = now,
                            ),
                        )
                    }
                }
            }
            db.purchaseOrderDao().upsert(order.copy(status = "received", updatedAt = now))
        }
    }

    // -- cancel -----------------------------------------------------------

    /**
     * Cancels a draft order. A received order cannot be cancelled — its
     * stock is already in, and the web has no purchase-return path for it —
     * so this throws instead of silently un-receiving stock. A draft was
     * never received, so cancelling touches no stock.
     */
    suspend fun cancelPurchaseOrder(id: Long) {
        val order = db.purchaseQueriesDao().getById(id)
            ?: throw IllegalArgumentException("Purchase order not found")
        require(canCancelPurchaseOrder(order.status)) {
            if (order.status == "received") {
                "A received purchase order cannot be cancelled — its stock is already in"
            } else {
                "Only a draft purchase order can be cancelled (status: ${order.status})"
            }
        }
        db.purchaseOrderDao().upsert(
            order.copy(status = "cancelled", updatedAt = Instant.now().toString()),
        )
    }
}
