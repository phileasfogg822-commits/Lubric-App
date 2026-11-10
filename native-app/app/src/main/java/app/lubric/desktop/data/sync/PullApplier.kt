package app.lubric.desktop.data.sync

import app.lubric.desktop.data.db.AccountEntity
import app.lubric.desktop.data.db.AccountTransactionEntity
import app.lubric.desktop.data.db.BrandEntity
import app.lubric.desktop.data.db.CashMovementEntity
import app.lubric.desktop.data.db.CategoryEntity
import app.lubric.desktop.data.db.CommitmentEntity
import app.lubric.desktop.data.db.CustomerEntity
import app.lubric.desktop.data.db.CustomerGroupEntity
import app.lubric.desktop.data.db.ExpenseEntity
import app.lubric.desktop.data.db.InspectionEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.db.OrderItemEntity
import app.lubric.desktop.data.db.PartyLedgerEntity
import app.lubric.desktop.data.db.PartyPriceEntity
import app.lubric.desktop.data.db.PartyPriceListEntity
import app.lubric.desktop.data.db.PriceListEntity
import app.lubric.desktop.data.db.PriceListItemEntity
import app.lubric.desktop.data.db.ProductEntity
import app.lubric.desktop.data.db.PurchaseOrderEntity
import app.lubric.desktop.data.db.ReminderEntity
import app.lubric.desktop.data.db.ReservationEntity
import app.lubric.desktop.data.db.ServiceEntity
import app.lubric.desktop.data.db.StockMovementEntity
import app.lubric.desktop.data.db.UnitConversionEntity
import app.lubric.desktop.data.db.UnitEntity
import app.lubric.desktop.data.db.VehicleEntity
import app.lubric.desktop.data.db.VendorEntity
import app.lubric.desktop.data.db.VendorPayableEntity
import app.lubric.desktop.data.db.WarehouseEntity
import app.lubric.desktop.data.db.WarehouseLocationEntity

/**
 * Maps one normalized pull row onto its Room entity and upserts it.
 *
 * Unknown keys in the row are ignored (the server sanitises rows against
 * its own columns anyway); missing keys fall back to the entity defaults.
 * The local `id` is preserved across re-pulls: the existing row is looked
 * up by uuid (or natural key) and its id reused, so a Room REPLACE upsert
 * updates in place instead of deleting + re-inserting with a new id (which
 * would orphan local child rows pointing at the old id — the web app's
 * `ON CONFLICT(uuid) DO UPDATE` has the same property).
 *
 * Throws on an unknown table or a row that cannot be mapped; the caller
 * ([SyncRepository]) catches per row / per table.
 */
object PullApplier {

    // -- typed accessors over a normalized row (values are null / String /
    //    Long / Double / Int, per SyncNormalize) --------------------------

    fun str(row: Map<String, Any?>, key: String): String? {
        val v = row[key] ?: return null
        return if (v is String) v else v.toString()
    }

    fun int(row: Map<String, Any?>, key: String): Int? {
        val v = row[key] ?: return null
        return when (v) {
            is Number -> v.toInt()
            is String -> v.toIntOrNull()
            else -> null
        }
    }

    fun dbl(row: Map<String, Any?>, key: String): Double? {
        val v = row[key] ?: return null
        return when (v) {
            is Number -> v.toDouble()
            is String -> v.toDoubleOrNull()
            else -> null
        }
    }

    fun bool(row: Map<String, Any?>, key: String): Boolean? {
        val v = row[key] ?: return null
        return when (v) {
            is Boolean -> v
            is Number -> v.toInt() != 0
            is String -> v == "1" || v.equals("true", ignoreCase = true)
            else -> null
        }
    }

    suspend fun apply(db: LubricDatabase, table: String, row: Map<String, Any?>) {
        when (table) {
            "products" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.productDao().getByUuid(it)?.id } ?: 0L
                db.productDao().upsert(
                    ProductEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        sku = str(row, "sku"),
                        barcode = str(row, "barcode"),
                        name = str(row, "name") ?: "",
                        brandId = int(row, "brand_id"),
                        categoryId = int(row, "category_id"),
                        packing = str(row, "packing") ?: "",
                        unit = str(row, "unit") ?: "piece",
                        variant = str(row, "variant") ?: "",
                        mfdDate = str(row, "mfd_date") ?: "",
                        expDate = str(row, "exp_date") ?: "",
                        offer = str(row, "offer") ?: "",
                        costPrice = dbl(row, "cost_price"),
                        stockQty = dbl(row, "stock_qty"),
                        lowStockThreshold = dbl(row, "low_stock_threshold"),
                        priceReturning = dbl(row, "price_returning"),
                        priceWalking = dbl(row, "price_walking"),
                        priceWholesale = dbl(row, "price_wholesale"),
                        wholesaleMinQty = dbl(row, "wholesale_min_qty"),
                        active = bool(row, "active") ?: true,
                        createdAt = str(row, "created_at"),
                        vendorId = int(row, "vendor_id"),
                        receivedDate = str(row, "received_date"),
                        unitId = int(row, "unit_id"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                        deletedAt = str(row, "deleted_at"),
                    ),
                )
            }
            "services" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.serviceDao().getByUuid(it)?.id } ?: 0L
                db.serviceDao().upsert(
                    ServiceEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        price = dbl(row, "price"),
                        active = bool(row, "active") ?: true,
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                        deletedAt = str(row, "deleted_at"),
                    ),
                )
            }
            "customers" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.customerDao().getByUuid(it)?.id } ?: 0L
                db.customerDao().upsert(
                    CustomerEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        phone = str(row, "phone") ?: "",
                        customerType = str(row, "customer_type") ?: "returning",
                        creditBalance = dbl(row, "credit_balance"),
                        lastVisitAt = str(row, "last_visit_at"),
                        createdAt = str(row, "created_at"),
                        groupId = int(row, "group_id"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                        deletedAt = str(row, "deleted_at"),
                    ),
                )
            }
            "vehicles" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.vehicleDao().getByUuid(it)?.id } ?: 0L
                db.vehicleDao().upsert(
                    VehicleEntity(
                        id = id,
                        customerId = int(row, "customer_id"),
                        registration = str(row, "registration") ?: "",
                        make = str(row, "make") ?: "",
                        model = str(row, "model") ?: "",
                        modelYear = str(row, "model_year") ?: "",
                        color = str(row, "color") ?: "",
                        condition = str(row, "condition") ?: "",
                        oilCapacity = dbl(row, "oil_capacity"),
                        mileage = int(row, "mileage"),
                        createdAt = str(row, "created_at"),
                        serviceIntervalDays = int(row, "service_interval_days"),
                        serviceIntervalKm = int(row, "service_interval_km"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                        deletedAt = str(row, "deleted_at"),
                        shopId = int(row, "shop_id"),
                    ),
                )
            }
            "vendors" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.vendorDao().getByUuid(it)?.id } ?: 0L
                db.vendorDao().upsert(
                    VendorEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        contact = str(row, "contact") ?: "",
                        phone = str(row, "phone") ?: "",
                        payableBalance = dbl(row, "payable_balance"),
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                        deletedAt = str(row, "deleted_at"),
                    ),
                )
            }
            "categories" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.categoryDao().getByUuid(it)?.id } ?: 0L
                db.categoryDao().upsert(
                    CategoryEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "brands" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.brandDao().getByUuid(it)?.id } ?: 0L
                db.brandDao().upsert(
                    BrandEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "orders" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.orderDao().getByUuid(it)?.id } ?: 0L
                db.orderDao().upsert(
                    OrderEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        customerId = int(row, "customer_id"),
                        userId = int(row, "user_id"),
                        total = dbl(row, "total"),
                        paidAmount = dbl(row, "paid_amount"),
                        paymentAccountId = int(row, "payment_account_id"),
                        paymentMethod = str(row, "payment_method") ?: "cash",
                        status = str(row, "status") ?: "completed",
                        vehicleId = int(row, "vehicle_id"),
                        mileage = int(row, "mileage"),
                        notes = str(row, "notes") ?: "",
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                        convertedFromCommitmentId = int(row, "converted_from_commitment_id"),
                    ),
                )
            }
            "order_items" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.orderItemDao().getByUuid(it)?.id } ?: 0L
                db.orderItemDao().upsert(
                    OrderItemEntity(
                        id = id,
                        orderId = int(row, "order_id"),
                        kind = str(row, "kind") ?: "",
                        refId = int(row, "ref_id"),
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        productName = str(row, "product_name") ?: "",
                        qty = dbl(row, "qty"),
                        unitPrice = dbl(row, "unit_price"),
                        lineTotal = dbl(row, "line_total"),
                        containerId = int(row, "container_id"),
                        capacity = dbl(row, "capacity"),
                        leftoverLitres = dbl(row, "leftover_litres"),
                        leftoverTo = str(row, "leftover_to") ?: "customer",
                        leftoverReleased = bool(row, "leftover_released") ?: false,
                        billedByCapacity = bool(row, "billed_by_capacity") ?: false,
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "expenses" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.expenseDao().getByUuid(it)?.id } ?: 0L
                db.expenseDao().upsert(
                    ExpenseEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        category = str(row, "category") ?: "",
                        subcategory = str(row, "subcategory") ?: "",
                        amount = dbl(row, "amount"),
                        accountId = int(row, "account_id"),
                        date = str(row, "date"),
                        note = str(row, "note") ?: "",
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                        deletedAt = str(row, "deleted_at"),
                    ),
                )
            }
            "accounts" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.accountDao().getByUuid(it)?.id } ?: 0L
                db.accountDao().upsert(
                    AccountEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        type = str(row, "type") ?: "cash",
                        balance = dbl(row, "balance"),
                        active = bool(row, "active") ?: true,
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                        accountClass = str(row, "account_class"),
                        code = str(row, "code"),
                    ),
                )
            }
            "account_transactions" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.accountTransactionDao().getByUuid(it)?.id } ?: 0L
                db.accountTransactionDao().upsert(
                    AccountTransactionEntity(
                        id = id,
                        accountId = int(row, "account_id"),
                        amount = dbl(row, "amount"),
                        type = str(row, "type") ?: "in",
                        reference = str(row, "reference") ?: "",
                        relatedAccountId = int(row, "related_account_id"),
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                        shopId = int(row, "shop_id"),
                    ),
                )
            }
            "purchase_orders" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.purchaseOrderDao().getByUuid(it)?.id } ?: 0L
                db.purchaseOrderDao().upsert(
                    PurchaseOrderEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        vendorId = int(row, "vendor_id"),
                        total = dbl(row, "total"),
                        paid = dbl(row, "paid"),
                        status = str(row, "status") ?: "completed",
                        notes = str(row, "notes") ?: "",
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "vendor_payables" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.vendorPayableDao().getByUuid(it)?.id } ?: 0L
                db.vendorPayableDao().upsert(
                    VendorPayableEntity(
                        id = id,
                        vendorId = int(row, "vendor_id"),
                        amount = dbl(row, "amount"),
                        dueDate = str(row, "due_date"),
                        status = str(row, "status") ?: "pending",
                        createdAt = str(row, "created_at"),
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "reminders" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.reminderDao().getByUuid(it)?.id } ?: 0L
                db.reminderDao().upsert(
                    ReminderEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        kind = str(row, "kind") ?: "todo",
                        title = str(row, "title") ?: "",
                        details = str(row, "details") ?: "",
                        dueAt = str(row, "due_at"),
                        dueKm = int(row, "due_km"),
                        lastMileage = int(row, "last_mileage"),
                        customerId = int(row, "customer_id"),
                        vehicleId = int(row, "vehicle_id"),
                        vendorId = int(row, "vendor_id"),
                        orderId = int(row, "order_id"),
                        priority = str(row, "priority") ?: "normal",
                        recurrenceDays = int(row, "recurrence_days"),
                        status = str(row, "status") ?: "pending",
                        completedAt = str(row, "completed_at"),
                        createdByUserId = int(row, "created_by_user_id"),
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                        uuid = uuid,
                    ),
                )
            }
            "inspections" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.inspectionDao().getByUuid(it)?.id } ?: 0L
                db.inspectionDao().upsert(
                    InspectionEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        customerId = int(row, "customer_id"),
                        vehicleId = int(row, "vehicle_id"),
                        data = str(row, "data") ?: "",
                        notes = str(row, "notes") ?: "",
                        userId = int(row, "user_id"),
                        createdAt = str(row, "created_at"),
                        orderId = int(row, "order_id"),
                        inspectionData = str(row, "inspection_data"),
                        uuid = uuid,
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "cash_movements" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.cashMovementDao().getByUuid(it)?.id } ?: 0L
                db.cashMovementDao().upsert(
                    CashMovementEntity(
                        id = id,
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        kind = str(row, "kind") ?: "",
                        amount = dbl(row, "amount"),
                        customerId = int(row, "customer_id"),
                        customerName = str(row, "customer_name"),
                        customerUuid = str(row, "customer_uuid"),
                        vendorId = int(row, "vendor_id"),
                        orderId = int(row, "order_id"),
                        accountId = int(row, "account_id"),
                        takenByUserId = int(row, "taken_by_user_id"),
                        takenByDeviceId = int(row, "taken_by_device_id"),
                        takenByName = str(row, "taken_by_name"),
                        postedAt = str(row, "posted_at"),
                        note = str(row, "note") ?: "",
                        occurredAt = str(row, "occurred_at"),
                        origin = str(row, "origin") ?: "shop",
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "reservations" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.reservationDao().getByUuid(it)?.id } ?: 0L
                db.reservationDao().upsert(
                    ReservationEntity(
                        id = id,
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        customerId = int(row, "customer_id"),
                        customerName = str(row, "customer_name"),
                        itemsJson = str(row, "items_json") ?: "[]",
                        amount = dbl(row, "amount"),
                        status = str(row, "status") ?: "open",
                        fulfilledOrderId = int(row, "fulfilled_order_id"),
                        createdByUserId = int(row, "created_by_user_id"),
                        note = str(row, "note") ?: "",
                        origin = str(row, "origin") ?: "shop",
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                        takenByName = str(row, "taken_by_name"),
                    ),
                )
            }
            "party_ledger" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.partyLedgerDao().getByUuid(it)?.id } ?: 0L
                db.partyLedgerDao().upsert(
                    PartyLedgerEntity(
                        id = id,
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        partyType = str(row, "party_type") ?: "",
                        partyId = int(row, "party_id"),
                        kind = str(row, "kind") ?: "",
                        direction = str(row, "direction") ?: "",
                        amount = dbl(row, "amount"),
                        orderId = int(row, "order_id"),
                        vendorPayableId = int(row, "vendor_payable_id"),
                        cashMovementId = int(row, "cash_movement_id"),
                        commitmentId = int(row, "commitment_id"),
                        note = str(row, "note") ?: "",
                        occurredAt = str(row, "occurred_at"),
                        origin = str(row, "origin") ?: "shop",
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "commitments" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.commitmentDao().getByUuid(it)?.id } ?: 0L
                db.commitmentDao().upsert(
                    CommitmentEntity(
                        id = id,
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        partyType = str(row, "party_type") ?: "customer",
                        partyId = int(row, "party_id"),
                        status = str(row, "status") ?: "booked",
                        total = dbl(row, "total"),
                        notes = str(row, "notes") ?: "",
                        takenByUserId = int(row, "taken_by_user_id"),
                        convertedOrderId = int(row, "converted_order_id"),
                        occurredAt = str(row, "occurred_at"),
                        origin = str(row, "origin") ?: "shop",
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "stock_movements" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.stockMovementDao().getByUuid(it)?.id } ?: 0L
                db.stockMovementDao().upsert(
                    StockMovementEntity(
                        id = id,
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        itemId = int(row, "item_id"),
                        kind = str(row, "kind") ?: "",
                        qty = dbl(row, "qty"),
                        qtyAfter = dbl(row, "qty_after"),
                        refTable = str(row, "ref_table"),
                        refId = int(row, "ref_id"),
                        warehouseId = int(row, "warehouse_id"),
                        note = str(row, "note") ?: "",
                        occurredAt = str(row, "occurred_at"),
                        createdByUserId = int(row, "created_by_user_id"),
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                        locationId = int(row, "location_id"),
                    ),
                )
            }
            "price_lists" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.priceListDao().getByUuid(it)?.id } ?: 0L
                db.priceListDao().upsert(
                    PriceListEntity(
                        id = id,
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        code = str(row, "code"),
                        isDefault = bool(row, "is_default") ?: false,
                        markupPct = dbl(row, "markup_pct"),
                        roundingMode = str(row, "rounding_mode") ?: "none",
                        roundingValue = dbl(row, "rounding_value"),
                        active = bool(row, "active") ?: true,
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "price_list_items" -> {
                val priceListId = int(row, "price_list_id")
                val productId = int(row, "product_id")
                val id = db.priceListItemDao()
                    .getByNaturalKey(priceListId, productId)?.id ?: 0L
                db.priceListItemDao().upsert(
                    PriceListItemEntity(
                        id = id,
                        priceListId = priceListId,
                        productId = productId,
                        price = dbl(row, "price"),
                        minQty = dbl(row, "min_qty"),
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "party_price_lists" -> {
                val partyType = str(row, "party_type") ?: ""
                val partyId = int(row, "party_id")
                val priceListId = int(row, "price_list_id")
                val id = db.partyPriceListDao()
                    .getByNaturalKey(partyType, partyId, priceListId)?.id ?: 0L
                db.partyPriceListDao().upsert(
                    PartyPriceListEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        partyType = partyType,
                        partyId = partyId,
                        priceListId = priceListId,
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "party_prices" -> {
                val partyType = str(row, "party_type") ?: ""
                val partyId = int(row, "party_id")
                val productId = int(row, "product_id")
                val id = db.partyPriceDao()
                    .getByNaturalKey(partyType, partyId, productId)?.id ?: 0L
                db.partyPriceDao().upsert(
                    PartyPriceEntity(
                        id = id,
                        shopId = int(row, "shop_id"),
                        partyType = partyType,
                        partyId = partyId,
                        productId = productId,
                        price = dbl(row, "price"),
                        note = str(row, "note") ?: "",
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "customer_groups" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.customerGroupDao().getByUuid(it)?.id } ?: 0L
                db.customerGroupDao().upsert(
                    CustomerGroupEntity(
                        id = id,
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        code = str(row, "code"),
                        priceTier = str(row, "price_tier") ?: "returning",
                        priceListId = int(row, "price_list_id"),
                        creditDays = int(row, "credit_days"),
                        creditLimit = dbl(row, "credit_limit"),
                        colour = str(row, "colour"),
                        active = bool(row, "active") ?: true,
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "units" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.unitDao().getByUuid(it)?.id } ?: 0L
                db.unitDao().upsert(
                    UnitEntity(
                        id = id,
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        plural = str(row, "plural"),
                        abbreviation = str(row, "abbreviation"),
                        dimension = str(row, "dimension") ?: "count",
                        decimalPlaces = int(row, "decimal_places"),
                        litresEach = dbl(row, "litres_each"),
                        active = bool(row, "active") ?: true,
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "unit_conversions" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.unitConversionDao().getByUuid(it)?.id } ?: 0L
                db.unitConversionDao().upsert(
                    UnitConversionEntity(
                        id = id,
                        uuid = uuid,
                        fromUnitId = int(row, "from_unit_id"),
                        toUnitId = int(row, "to_unit_id"),
                        multiplier = dbl(row, "multiplier"),
                        createdAt = str(row, "created_at"),
                    ),
                )
            }
            "warehouses" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.warehouseDao().getByUuid(it)?.id } ?: 0L
                db.warehouseDao().upsert(
                    WarehouseEntity(
                        id = id,
                        uuid = uuid,
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        code = str(row, "code"),
                        address = str(row, "address"),
                        isDefault = bool(row, "is_default") ?: false,
                        active = bool(row, "active") ?: true,
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            "warehouse_locations" -> {
                val uuid = str(row, "uuid")
                val id = uuid?.let { db.warehouseLocationDao().getByUuid(it)?.id } ?: 0L
                db.warehouseLocationDao().upsert(
                    WarehouseLocationEntity(
                        id = id,
                        uuid = uuid,
                        warehouseId = int(row, "warehouse_id"),
                        shopId = int(row, "shop_id"),
                        name = str(row, "name") ?: "",
                        code = str(row, "code"),
                        kind = str(row, "kind") ?: "rack",
                        active = bool(row, "active") ?: true,
                        createdAt = str(row, "created_at"),
                        updatedAt = str(row, "updated_at"),
                    ),
                )
            }
            else -> throw IllegalArgumentException("Unknown sync table: $table")
        }
    }
}
