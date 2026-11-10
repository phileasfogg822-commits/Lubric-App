package app.lubric.desktop

import app.lubric.desktop.data.db.ContainerEntity
import app.lubric.desktop.data.db.ProductEntity
import app.lubric.desktop.data.db.VehicleEntity
import app.lubric.desktop.data.sale.SaleBuilder
import app.lubric.desktop.data.sale.SaleLineInput
import app.lubric.desktop.data.sale.VehicleFormInput
import app.lubric.desktop.data.sale.VehicleUpsert
import app.lubric.desktop.data.sale.VehicleUpsertPlan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SaleContentsTest {

    private val nowIso = "2026-11-11T10:00:00Z"
    private val oil = ProductEntity(id = 1, name = "Engine Oil 4L", packing = "4L", stockQty = 10.0)
    private val filter = ProductEntity(id = 2, name = "Oil Filter", packing = "1pc", stockQty = 5.0)
    private val vehicle = VehicleEntity(
        id = 9,
        customerId = 5,
        registration = "ABC-123",
        make = "Toyota",
        model = "Corolla",
        serviceIntervalDays = 60,
        serviceIntervalKm = 3000,
    )
    private val openContainer = ContainerEntity(
        id = 11,
        productId = 3,
        originalVolume = 4.0,
        remainingVolume = 2.0,
        status = "opened",
        openedAt = "2026-11-01T00:00:00Z",
        sourceOrderId = 1,
    )

    private fun lines() = listOf(
        SaleLineInput(
            kind = "product", refId = 1, name = "Engine Oil 4L",
            qty = 1.0, unitPrice = 3500.0, lineTotal = 3500.0,
            capacity = 3.5, billByCapacity = true, leftoverToContainers = true,
            product = oil,
        ),
        SaleLineInput(
            kind = "product", refId = 2, name = "Oil Filter",
            qty = 2.0, unitPrice = 500.0, lineTotal = 1000.0,
            product = filter,
        ),
        SaleLineInput(
            kind = "service", refId = 7, name = "Oil Change",
            qty = 1.0, unitPrice = 800.0, lineTotal = 800.0,
        ),
        SaleLineInput(
            kind = "partial_container", refId = 3, name = "Engine Oil (loose)",
            qty = 1.5, unitPrice = 900.0, lineTotal = 1350.0,
            containerId = 11,
        ),
        SaleLineInput(
            kind = "used_oil", refId = 0, name = "Used Oil",
            qty = 2.0, unitPrice = 0.0, lineTotal = 0.0,
        ),
    )

    private fun build(
        total: Double = 6650.0,
        hasPendingServiceDue: Boolean = false,
        vehicleId: Int? = 9,
        vehicle: VehicleEntity? = this.vehicle,
        customerId: Int? = 5,
        lines: List<SaleLineInput> = lines(),
    ) = SaleBuilder.build(
        orderId = 42,
        lines = lines,
        userId = 1,
        customerId = customerId,
        paymentAccountId = 1,
        total = total,
        mileage = 50000,
        notes = "test",
        vehicleId = vehicleId,
        shopId = 1,
        nowIso = nowIso,
        productsById = mapOf(1 to oil, 2 to filter),
        accountBalance = 10000.0,
        defaultWarehouseId = 1,
        customerName = "Aqeel",
        vehicle = vehicle,
        hasPendingServiceDue = hasPendingServiceDue,
        usedOilDrumLitres = 50.0,
        containersById = mapOf(11 to openContainer),
    )

    @Test
    fun `order row carries the sale totals and state`() {
        val result = build()
        assertEquals(42L, result.order.id)
        assertEquals(6650.0, result.order.total!!, 0.0)
        assertEquals(result.order.total, result.order.paidAmount)
        assertEquals("completed", result.order.status)
        assertEquals("cash", result.order.paymentMethod)
        assertEquals(5, result.order.customerId)
        assertEquals(9, result.order.vehicleId)
        assertEquals(50000, result.order.mileage)
        assertEquals(nowIso, result.order.createdAt)
        assertTrue(result.order.uuid!!.isNotBlank())
    }

    @Test
    fun `product line with capacity bills by capacity and leaves oil in a container`() {
        val result = build()
        val line = result.items[0]
        assertEquals("product", line.kind)
        assertEquals(3.5, line.capacity!!, 0.0)
        assertEquals(0.5, line.leftoverLitres!!, 0.0)
        assertEquals("container", line.leftoverTo)
        assertTrue(line.billedByCapacity)
        assertEquals(42, line.orderId)
    }

    @Test
    fun `plain product line leaves nothing and bills normally`() {
        val result = build()
        val line = result.items[1]
        assertEquals(0.0, line.leftoverLitres!!, 0.0)
        assertEquals("customer", line.leftoverTo)
        assertTrue(!line.billedByCapacity)
    }

    @Test
    fun `leftover oil becomes a new opened container`() {
        val result = build()
        assertEquals(1, result.containersToInsert.size)
        val container = result.containersToInsert[0]
        assertEquals(1, container.productId)
        assertEquals(4.0, container.originalVolume!!, 0.0)
        assertEquals(0.5, container.remainingVolume!!, 0.0)
        assertEquals("opened", container.status)
        assertEquals(42, container.sourceOrderId)
    }

    @Test
    fun `stock movements and product stock updates are negative with correct qtyAfter`() {
        val result = build()
        assertEquals(2, result.stockMovements.size)
        val oilMovement = result.stockMovements[0]
        assertEquals(-1.0, oilMovement.qty!!, 0.0)
        assertEquals(9.0, oilMovement.qtyAfter!!, 0.0)
        assertEquals("sale", oilMovement.kind)
        assertEquals("orders", oilMovement.refTable)
        assertEquals(42, oilMovement.refId)
        assertEquals(1, oilMovement.warehouseId)
        val filterMovement = result.stockMovements[1]
        assertEquals(-2.0, filterMovement.qty!!, 0.0)
        assertEquals(3.0, filterMovement.qtyAfter!!, 0.0)
        assertEquals(listOf(1L to 9.0, 2L to 3.0), result.productStockUpdates)
    }

    @Test
    fun `partial container line drains the container and records a split`() {
        val result = build()
        assertEquals(1, result.containerUpdates.size)
        val updated = result.containerUpdates[0]
        assertEquals(11L, updated.id)
        assertEquals(0.5, updated.remainingVolume!!, 0.0)
        assertEquals("opened", updated.status)
        assertEquals(1, result.containerSplits.size)
        val split = result.containerSplits[0]
        assertEquals(11, split.containerId)
        assertEquals(1.5, split.soldQty!!, 0.0)
        assertEquals(42, split.orderId)
        assertEquals(nowIso, split.soldAt)
    }

    @Test
    fun `used oil line tops up the drum and logs the addition`() {
        val result = build()
        assertEquals(52.0, result.usedOilDrumLitres!!, 0.0)
        assertEquals(1, result.usedOilLogs.size)
        val log = result.usedOilLogs[0]
        assertEquals(1, log.drumId)
        assertEquals(2.0, log.litres!!, 0.0)
        assertEquals("added", log.type)
        assertEquals(42, log.sourceOrderId)
    }

    @Test
    fun `account balance and transaction follow a positive total`() {
        val result = build()
        assertEquals(1L to 16650.0, result.accountBalanceUpdate)
        val tx = result.accountTransaction!!
        assertEquals(1, tx.accountId)
        assertEquals(6650.0, tx.amount!!, 0.0)
        assertEquals("in", tx.type)
        assertEquals("Order #42", tx.reference)
    }

    @Test
    fun `customer last visit is set`() {
        assertEquals(5L, build().customerLastVisit)
    }

    @Test
    fun `service line with a vehicle creates a service-due reminder`() {
        val result = build()
        val reminder = result.reminder!!
        assertEquals("Service due: Toyota Corolla ABC-123 (Aqeel)", reminder.title)
        assertEquals(
            "Next oil change / service for Aqeel — about 3000 km from the last visit.",
            reminder.details,
        )
        assertEquals("2027-01-10T10:00:00Z", reminder.dueAt)
        assertEquals(53000, reminder.dueKm)
        assertEquals(50000, reminder.lastMileage)
        assertEquals(5, reminder.customerId)
        assertEquals(9, reminder.vehicleId)
        assertEquals(42, reminder.orderId)
        assertEquals("service_due", reminder.kind)
        assertEquals("pending", reminder.status)
    }

    @Test
    fun `zero total emits no account rows`() {
        val result = build(total = 0.0, lines = emptyList(), vehicleId = null, vehicle = null, customerId = null)
        assertNull(result.accountBalanceUpdate)
        assertNull(result.accountTransaction)
        assertEquals(0.0, result.order.total!!, 0.0)
        assertNull(result.customerLastVisit)
        assertNull(result.reminder)
    }

    @Test
    fun `service without a vehicle emits no reminder`() {
        val result = build(vehicleId = null, vehicle = null)
        assertNull(result.reminder)
        assertEquals(5L, result.customerLastVisit)
    }

    @Test
    fun `pending service due suppresses a duplicate reminder`() {
        val result = build(hasPendingServiceDue = true)
        assertNull(result.reminder)
    }

    // -- VehicleUpsert.plan -------------------------------------------------

    private val formInput = VehicleFormInput(
        registration = " abc-123 ",
        make = " Toyota ",
        model = "Corolla",
        modelYear = "2020",
        color = "White",
        condition = "Good",
    )
    private val existing = VehicleEntity(
        id = 7,
        customerId = 5,
        registration = "ABC-123",
        make = "Old",
        model = "Old",
    )

    @Test
    fun `blank registration skips the upsert`() {
        val blank = VehicleFormInput(registration = "   ")
        assertEquals(VehicleUpsertPlan.Skip, VehicleUpsert.plan(null, 5, blank, null, null))
        assertEquals(VehicleUpsertPlan.Skip, VehicleUpsert.plan(existing, 5, blank, 50000, 4.5))
    }

    @Test
    fun `existing vehicle plans an update with the passed oil capacity`() {
        assertEquals(
            VehicleUpsertPlan.Update(
                vehicleId = 7,
                make = "Toyota",
                model = "Corolla",
                modelYear = "2020",
                color = "White",
                condition = "Good",
                oilCapacity = 4.5,
            ),
            VehicleUpsert.plan(existing, 5, formInput, 50000, 4.5),
        )
    }

    @Test
    fun `no existing vehicle plans an insert with mileage and oil capacity`() {
        assertEquals(
            VehicleUpsertPlan.Insert(
                customerId = 5,
                registration = "abc-123",
                make = "Toyota",
                model = "Corolla",
                modelYear = "2020",
                color = "White",
                condition = "Good",
                mileage = 50000,
                oilCapacity = 4.5,
            ),
            VehicleUpsert.plan(null, 5, formInput, 50000, 4.5),
        )
    }

    @Test
    fun `form variant plans without oil capacity or mileage`() {
        assertEquals(
            VehicleUpsertPlan.Update(
                vehicleId = 7,
                make = "Toyota",
                model = "Corolla",
                modelYear = "2020",
                color = "White",
                condition = "Good",
                oilCapacity = null,
            ),
            VehicleUpsert.plan(existing, 5, formInput, null, null),
        )
        assertEquals(
            VehicleUpsertPlan.Insert(
                customerId = 5,
                registration = "abc-123",
                make = "Toyota",
                model = "Corolla",
                modelYear = "2020",
                color = "White",
                condition = "Good",
                mileage = null,
                oilCapacity = null,
            ),
            VehicleUpsert.plan(null, 5, formInput, null, null),
        )
    }
}
