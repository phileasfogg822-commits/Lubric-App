package app.lubric.desktop.data.sale

import app.lubric.desktop.data.db.AccountTransactionEntity
import app.lubric.desktop.data.db.ContainerEntity
import app.lubric.desktop.data.db.ContainerSplitEntity
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.db.OrderItemEntity
import app.lubric.desktop.data.db.ProductEntity
import app.lubric.desktop.data.db.ReminderEntity
import app.lubric.desktop.data.db.StockMovementEntity
import app.lubric.desktop.data.db.UsedOilLogEntity
import app.lubric.desktop.data.db.VehicleEntity
import app.lubric.desktop.data.pricing.leftoverLitres
import app.lubric.desktop.data.pricing.packLitres
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.math.abs

data class SaleLineInput(
    val kind: String,
    val refId: Int,
    val name: String,
    val qty: Double,
    val unitPrice: Double,
    val lineTotal: Double,
    val containerId: Int? = null,
    val capacity: Double = 0.0,
    val billByCapacity: Boolean = false,
    val leftoverToContainers: Boolean = true,
    val product: ProductEntity? = null,
)

data class SaleVehicleInput(
    val registration: String,
    val make: String = "",
    val model: String = "",
    val modelYear: String = "",
    val color: String = "",
    val condition: String = "",
)

data class SaleBuild(
    val order: OrderEntity,
    val items: List<OrderItemEntity>,
    val containersToInsert: List<ContainerEntity>,
    val stockMovements: List<StockMovementEntity>,
    val productStockUpdates: List<Pair<Long, Double>>,
    val containerUpdates: List<ContainerEntity>,
    val containerSplits: List<ContainerSplitEntity>,
    val usedOilDrumLitres: Double?,
    val usedOilLogs: List<UsedOilLogEntity>,
    val accountBalanceUpdate: Pair<Long, Double>?,
    val accountTransaction: AccountTransactionEntity?,
    val customerLastVisit: Long?,
    val reminder: ReminderEntity?,
)

/**
 * Pure sale builder: builds every row a sale writes, so unit tests can
 * assert contents without a database. Implements the web `completeSale`
 * transaction (`POSCart.tsx`), in order.
 *
 * Deliberate deviations from the web, both noted where they occur:
 * - `stock_levels` rows are NOT emitted here: Room has no
 *   UNIQUE(warehouse_id, product_id), so the web's ON CONFLICT upsert
 *   cannot be reproduced. [SaleRepository] does a manual get-or-create
 *   level update instead, from [SaleBuild.stockMovements].
 * - A null service interval falls back to 60 days / 3000 km for the
 *   reminder; the web would write NULL (undefined) there.
 *
 * The builder is pure, so it needs the current container row for a
 * `partial_container` line: pass it in [containersById]. A partial line
 * whose container row is absent from the map is skipped (no update, no
 * split) — the repository loads those rows before building.
 */
object SaleBuilder {
    fun build(
        orderId: Long,
        lines: List<SaleLineInput>,
        userId: Int,
        customerId: Int?,
        paymentAccountId: Int,
        total: Double,
        mileage: Int,
        notes: String,
        vehicleId: Int?,
        shopId: Int,
        nowIso: String,
        productsById: Map<Int, ProductEntity>,
        accountBalance: Double,
        defaultWarehouseId: Long?,
        customerName: String?,
        vehicle: VehicleEntity?,
        hasPendingServiceDue: Boolean = false,
        usedOilDrumLitres: Double = 0.0,
        containersById: Map<Int, ContainerEntity> = emptyMap(),
    ): SaleBuild {
        val order = OrderEntity(
            id = orderId,
            shopId = shopId,
            customerId = customerId,
            userId = userId,
            total = total,
            paidAmount = total,
            paymentAccountId = paymentAccountId,
            paymentMethod = "cash",
            status = "completed",
            vehicleId = vehicleId,
            mileage = mileage,
            notes = notes,
            createdAt = nowIso,
            uuid = UUID.randomUUID().toString(),
            updatedAt = nowIso,
        )

        val items = mutableListOf<OrderItemEntity>()
        val containersToInsert = mutableListOf<ContainerEntity>()
        val stockMovements = mutableListOf<StockMovementEntity>()
        val productStockUpdates = mutableListOf<Pair<Long, Double>>()
        val containerUpdates = mutableListOf<ContainerEntity>()
        val containerSplits = mutableListOf<ContainerSplitEntity>()
        val usedOilLogs = mutableListOf<UsedOilLogEntity>()
        var usedOilTotal = 0.0
        var hasUsedOil = false

        for (line in lines) {
            val product = line.product ?: productsById[line.refId]
            val pack = product?.let { packLitres(it.packing) } ?: 0.0
            val lo = if (product != null) leftoverLitres(pack, line.capacity) else 0.0
            val toContainers = line.kind == "product" && line.leftoverToContainers && lo > 0.0
            val byCapacity = line.kind == "product" && line.billByCapacity
            items += OrderItemEntity(
                orderId = orderId.toInt(),
                kind = line.kind,
                refId = line.refId,
                productName = line.name,
                qty = line.qty,
                unitPrice = line.unitPrice,
                lineTotal = line.lineTotal,
                containerId = line.containerId,
                capacity = if (product != null) line.capacity else 0.0,
                leftoverLitres = lo,
                leftoverTo = if (toContainers) "container" else "customer",
                leftoverReleased = false,
                billedByCapacity = byCapacity,
                uuid = UUID.randomUUID().toString(),
                shopId = shopId,
                updatedAt = nowIso,
            )
            if (toContainers) {
                containersToInsert += ContainerEntity(
                    shopId = shopId,
                    productId = line.refId,
                    originalVolume = pack.takeIf { it > 0.0 } ?: lo,
                    remainingVolume = lo,
                    status = "opened",
                    openedAt = nowIso,
                    sourceOrderId = orderId.toInt(),
                )
            }
            if (line.kind == "product") {
                val currentStock = productsById[line.refId]?.stockQty ?: 0.0
                val delta = -abs(line.qty)
                stockMovements += StockMovementEntity(
                    uuid = UUID.randomUUID().toString(),
                    shopId = shopId,
                    itemId = line.refId,
                    kind = "sale",
                    qty = delta,
                    qtyAfter = currentStock + delta,
                    refTable = "orders",
                    refId = orderId.toInt(),
                    warehouseId = defaultWarehouseId?.toInt(),
                    locationId = null,
                    note = "",
                    occurredAt = nowIso,
                )
                productStockUpdates += line.refId.toLong() to (currentStock + delta)
            }
            if (line.kind == "partial_container" && line.containerId != null) {
                val container = containersById[line.containerId]
                if (container != null) {
                    val remaining = (container.remainingVolume ?: 0.0) - line.qty
                    containerUpdates += container.copy(
                        remainingVolume = remaining,
                        status = if (remaining <= 0.0) "empty" else "opened",
                    )
                    containerSplits += ContainerSplitEntity(
                        containerId = line.containerId,
                        soldQty = line.qty,
                        orderId = orderId.toInt(),
                        soldAt = nowIso,
                    )
                }
            }
            if (line.kind == "used_oil") {
                hasUsedOil = true
                usedOilTotal += line.qty
                usedOilLogs += UsedOilLogEntity(
                    drumId = 1,
                    litres = line.qty,
                    type = "added",
                    sourceOrderId = orderId.toInt(),
                    createdAt = nowIso,
                )
            }
        }

        val accountBalanceUpdate: Pair<Long, Double>? =
            if (total > 0.0) paymentAccountId.toLong() to (accountBalance + total) else null
        val accountTransaction: AccountTransactionEntity? =
            if (total > 0.0) {
                AccountTransactionEntity(
                    accountId = paymentAccountId,
                    amount = total,
                    type = "in",
                    reference = "Order #$orderId",
                    uuid = UUID.randomUUID().toString(),
                    shopId = shopId,
                    updatedAt = nowIso,
                    createdAt = nowIso,
                )
            } else {
                null
            }

        // Service reminder, only when no pending one already exists for
        // this vehicle. Null intervals fall back to 60 days / 3000 km —
        // a deliberate deviation from the web's undefined NULL behaviour.
        val reminder: ReminderEntity? =
            if (lines.any { it.kind == "service" } && vehicleId != null &&
                vehicle != null && !hasPendingServiceDue
            ) {
                val intervalKm = vehicle.serviceIntervalKm ?: 3000
                val intervalDays = vehicle.serviceIntervalDays ?: 60
                ReminderEntity(
                    shopId = shopId,
                    kind = "service_due",
                    title = "Service due: " +
                        concatNonBlank(vehicle.make, vehicle.model, vehicle.registration) +
                        " (" + (customerName ?: "") + ")",
                    details = "Next oil change / service for " + (customerName ?: "") +
                        " — about " + intervalKm + " km from the last visit.",
                    dueAt = Instant.parse(nowIso)
                        .plus(Duration.ofDays(intervalDays.toLong())).toString(),
                    dueKm = mileage + intervalKm,
                    lastMileage = mileage,
                    customerId = customerId,
                    vehicleId = vehicleId,
                    orderId = orderId.toInt(),
                    priority = "normal",
                    status = "pending",
                    createdByUserId = userId,
                    createdAt = nowIso,
                    updatedAt = nowIso,
                    uuid = UUID.randomUUID().toString(),
                )
            } else {
                null
            }

        return SaleBuild(
            order = order,
            items = items,
            containersToInsert = containersToInsert,
            stockMovements = stockMovements,
            productStockUpdates = productStockUpdates,
            containerUpdates = containerUpdates,
            containerSplits = containerSplits,
            usedOilDrumLitres = if (hasUsedOil) usedOilDrumLitres + usedOilTotal else null,
            usedOilLogs = usedOilLogs,
            accountBalanceUpdate = accountBalanceUpdate,
            accountTransaction = accountTransaction,
            customerLastVisit = customerId?.toLong(),
            reminder = reminder,
        )
    }

    private fun concatNonBlank(vararg parts: String): String =
        parts.map { it.trim() }.filter { it.isNotEmpty() }.joinToString(" ")
}
