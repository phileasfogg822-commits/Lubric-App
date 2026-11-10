package app.lubric.desktop.data.sale

import androidx.room.withTransaction
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.StockLevelEntity
import app.lubric.desktop.data.db.VehicleEntity
import java.time.Instant
import java.util.UUID

data class SaleResult(val orderId: Long)

class SaleRepository(private val db: LubricDatabase) {

    /** Most recently added vehicle for a customer, or null. */
    suspend fun mostRecentVehicle(customerId: Int): VehicleEntity? =
        db.vehicleDao().byCustomer(customerId).firstOrNull()

    /**
     * Vehicle upsert, OUTSIDE any sale transaction (matches the web: a
     * failed sale does not roll the vehicle back). Returns the vehicle id,
     * or null when the registration was blank ([VehicleUpsertPlan.Skip]).
     * `upsert` returns Unit, so an insert re-queries to learn the id.
     */
    suspend fun upsertVehicle(
        customerId: Int,
        input: SaleVehicleInput,
        mileage: Int,
        oilCapacity: Double,
        shopId: Int,
    ): Int? {
        val existing = db.vehicleDao()
            .getByCustomerAndRegistration(customerId, input.registration.trim())
        val form = VehicleFormInput(
            registration = input.registration,
            make = input.make,
            model = input.model,
            modelYear = input.modelYear,
            color = input.color,
            condition = input.condition,
        )
        return when (val plan = VehicleUpsert.plan(existing, customerId, form, mileage, oilCapacity)) {
            is VehicleUpsertPlan.Skip -> null
            is VehicleUpsertPlan.Update -> {
                val current = requireNotNull(existing)
                db.vehicleDao().upsert(
                    current.copy(
                        make = plan.make,
                        model = plan.model,
                        modelYear = plan.modelYear,
                        color = plan.color,
                        condition = plan.condition,
                        oilCapacity = plan.oilCapacity,
                    ),
                )
                current.id.toInt()
            }
            is VehicleUpsertPlan.Insert -> {
                db.vehicleDao().upsert(
                    VehicleEntity(
                        customerId = plan.customerId,
                        registration = plan.registration,
                        make = plan.make,
                        model = plan.model,
                        modelYear = plan.modelYear,
                        color = plan.color,
                        condition = plan.condition,
                        oilCapacity = plan.oilCapacity,
                        mileage = plan.mileage,
                        uuid = UUID.randomUUID().toString(),
                        shopId = shopId,
                    ),
                )
                db.vehicleDao()
                    .getByCustomerAndRegistration(customerId, plan.registration)?.id?.toInt()
            }
        }
    }

    /**
     * Completes a sale in the web's order: (1) reserve the order id
     * (MAX(id)+1, outside the transaction — a failed sale leaves a gap,
     * matching the web); (2) load everything the pure builder needs;
     * (3) build every row; (4) write them atomically; (5) return the id.
     *
     * All inserts carry fresh uuids (the builder does it) so the outbox
     * triggers queue them for sync; containers, container_splits,
     * used-oil rows and stock_levels have no triggers (not synced) —
     * correct, matching the web.
     */
    suspend fun completeSale(
        lines: List<SaleLineInput>,
        userId: Int,
        customerId: Int?,
        paymentAccountId: Int,
        total: Double,
        mileage: Int,
        notes: String,
        vehicleId: Int?,
        shopId: Int,
    ): SaleResult {
        val oid = db.orderDao().maxId() + 1
        val nowIso = Instant.now().toString()

        val productsById = lines.filter { it.kind == "product" }
            .map { it.refId }.distinct()
            .associateWith { refId ->
                db.productDao().getById(refId.toLong())
                    ?: error("Product $refId not found for sale line")
            }
        val containersById = lines
            .filter { it.kind == "partial_container" && it.containerId != null }
            .mapNotNull { it.containerId }.distinct()
            .mapNotNull { containerId ->
                db.containerDao().getById(containerId.toLong())?.let { containerId to it }
            }
            .toMap()
        val account = db.accountDao().getById(paymentAccountId.toLong())
            ?: error("Account $paymentAccountId not found")
        val accountBalance = account.balance ?: 0.0
        val defaultWarehouseId = db.warehouseDao().defaultId(shopId)
        val customerName = customerId?.let { db.customerDao().getById(it.toLong())?.name }
        val vehicle = vehicleId?.let { db.vehicleDao().getById(it.toLong()) }
        val hasPendingServiceDue = vehicleId?.let {
            db.reminderDao().pendingServiceDueCount(it) > 0
        } ?: false
        val usedOilDrumLitres = db.usedOilDrumDao().getById(1)?.currentLitres ?: 0.0

        val build = SaleBuilder.build(
            orderId = oid,
            lines = lines,
            userId = userId,
            customerId = customerId,
            paymentAccountId = paymentAccountId,
            total = total,
            mileage = mileage,
            notes = notes,
            vehicleId = vehicleId,
            shopId = shopId,
            nowIso = nowIso,
            productsById = productsById,
            accountBalance = accountBalance,
            defaultWarehouseId = defaultWarehouseId,
            customerName = customerName,
            vehicle = vehicle,
            hasPendingServiceDue = hasPendingServiceDue,
            usedOilDrumLitres = usedOilDrumLitres,
            containersById = containersById,
        )

        db.withTransaction {
            db.orderDao().upsert(build.order)
            build.items.forEach { db.orderItemDao().upsert(it) }
            build.containersToInsert.forEach { db.containerDao().upsert(it) }
            build.stockMovements.forEach { db.stockMovementDao().upsert(it) }
            build.productStockUpdates.forEach { (pid, newQty) ->
                val p = db.productDao().getById(pid)!!
                db.productDao().upsert(p.copy(stockQty = newQty))
            }
            build.containerUpdates.forEach { db.containerDao().upsert(it) }
            build.containerSplits.forEach { db.containerSplitDao().upsert(it) }
            build.usedOilDrumLitres?.let { litres ->
                val drum = db.usedOilDrumDao().getById(1)!!
                db.usedOilDrumDao().upsert(drum.copy(currentLitres = litres))
            }
            build.usedOilLogs.forEach { db.usedOilLogDao().upsert(it) }
            build.accountBalanceUpdate?.let { (aid, bal) ->
                val a = db.accountDao().getById(aid)!!
                db.accountDao().upsert(a.copy(balance = bal))
            }
            build.accountTransaction?.let { db.accountTransactionDao().upsert(it) }
            build.customerLastVisit?.let { cid ->
                val c = db.customerDao().getById(cid)!!
                db.customerDao().upsert(c.copy(lastVisitAt = nowIso))
            }
            build.reminder?.let { db.reminderDao().upsert(it) }
            // Stock levels: Room has no UNIQUE(warehouse_id, product_id),
            // so the web's ON CONFLICT upsert cannot be reproduced —
            // manual get-or-create instead, using the same delta as the
            // stock movement (summed per product across the sale).
            val warehouseId = defaultWarehouseId?.toInt()
            if (warehouseId != null) {
                val deltas = build.stockMovements
                    .filter { it.itemId != null }
                    .groupBy { it.itemId!! }
                    .mapValues { (_, movements) -> movements.sumOf { it.qty ?: 0.0 } }
                for ((productId, delta) in deltas) {
                    val level = db.stockLevelDao()
                        .getByWarehouseAndProduct(warehouseId, productId)
                    if (level == null) {
                        db.stockLevelDao().upsert(
                            StockLevelEntity(
                                warehouseId = warehouseId,
                                productId = productId,
                                qty = delta,
                                uuid = UUID.randomUUID().toString(),
                                shopId = shopId,
                            ),
                        )
                    } else {
                        db.stockLevelDao()
                            .upsert(level.copy(qty = (level.qty ?: 0.0) + delta))
                    }
                }
            }
        }

        return SaleResult(oid)
    }

    /**
     * Web `releaseLeftoverToCustomer`: give a leftover container's
     * remaining litres back to the customer (up to [litres]) and mark
     * the order item released.
     */
    suspend fun releaseLeftoverToCustomer(
        orderId: Int,
        orderItemId: Long,
        productId: Int,
        litres: Double,
    ) {
        val container = db.containerDao().bySourceOrderAndProduct(orderId, productId)
        db.withTransaction {
            if (container != null) {
                val take = minOf(litres, container.remainingVolume ?: 0.0)
                val remaining = (container.remainingVolume ?: 0.0) - take
                db.containerDao().upsert(
                    container.copy(
                        remainingVolume = maxOf(0.0, remaining),
                        status = if (remaining <= 0.0) "empty" else container.status,
                    ),
                )
            }
            val item = db.orderItemDao().getById(orderItemId)
            if (item != null) {
                db.orderItemDao()
                    .upsert(item.copy(leftoverTo = "customer", leftoverReleased = true))
            }
        }
    }
}
