package app.lubric.desktop.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

// ---------------------------------------------------------------------------
// Khata: commitments, commitment_items, party_ledger, payable_allocations
// ---------------------------------------------------------------------------

@Entity(
    tableName = "commitments",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["shop_id", "party_type", "party_id", "occurred_at"]),
    ],
)
data class CommitmentEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "party_type") val partyType: String = "customer",
    @ColumnInfo(name = "party_id") val partyId: Int? = null,
    val status: String = "booked",
    val total: Double? = 0.0,
    val notes: String = "",
    @ColumnInfo(name = "taken_by_user_id") val takenByUserId: Int? = null,
    @ColumnInfo(name = "converted_order_id") val convertedOrderId: Int? = null,
    @ColumnInfo(name = "occurred_at") val occurredAt: String? = null,
    val origin: String = "shop",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

@Entity(
    tableName = "commitment_items",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class CommitmentItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "commitment_id") val commitmentId: Int? = null,
    val kind: String = "product",
    @ColumnInfo(name = "ref_id") val refId: Int? = null,
    @ColumnInfo(name = "product_name") val productName: String = "",
    val qty: Double? = 1.0,
    @ColumnInfo(name = "unit_price") val unitPrice: Double? = 0.0,
    @ColumnInfo(name = "line_total") val lineTotal: Double? = 0.0,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

@Entity(
    tableName = "party_ledger",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["shop_id", "party_type", "party_id", "occurred_at"]),
        Index(value = ["shop_id", "updated_at"]),
    ],
)
data class PartyLedgerEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "party_type") val partyType: String = "",
    @ColumnInfo(name = "party_id") val partyId: Int? = null,
    val kind: String = "",
    val direction: String = "",
    val amount: Double? = 0.0,
    @ColumnInfo(name = "order_id") val orderId: Int? = null,
    @ColumnInfo(name = "vendor_payable_id") val vendorPayableId: Int? = null,
    @ColumnInfo(name = "cash_movement_id") val cashMovementId: Int? = null,
    @ColumnInfo(name = "commitment_id") val commitmentId: Int? = null,
    val note: String = "",
    @ColumnInfo(name = "occurred_at") val occurredAt: String? = null,
    val origin: String = "shop",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

@Entity(
    tableName = "payable_allocations",
    indices = [
        Index(value = ["vendor_payable_id"]),
        Index(value = ["payment_uuid"]),
    ],
)
data class PayableAllocationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "payment_uuid") val paymentUuid: String = "",
    @ColumnInfo(name = "vendor_payable_id") val vendorPayableId: Int? = null,
    val amount: Double? = 0.0,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
)

// ---------------------------------------------------------------------------
// Field data: cash_movements, reservations
// ---------------------------------------------------------------------------

@Entity(
    tableName = "cash_movements",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["occurred_at"]),
    ],
)
data class CashMovementEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val kind: String = "",
    val amount: Double? = 0.0,
    @ColumnInfo(name = "customer_id") val customerId: Int? = null,
    @ColumnInfo(name = "customer_name") val customerName: String? = null,
    @ColumnInfo(name = "customer_uuid") val customerUuid: String? = null,
    @ColumnInfo(name = "vendor_id") val vendorId: Int? = null,
    @ColumnInfo(name = "order_id") val orderId: Int? = null,
    @ColumnInfo(name = "account_id") val accountId: Int? = null,
    @ColumnInfo(name = "taken_by_user_id") val takenByUserId: Int? = null,
    @ColumnInfo(name = "taken_by_device_id") val takenByDeviceId: Int? = null,
    @ColumnInfo(name = "taken_by_name") val takenByName: String? = null,
    @ColumnInfo(name = "posted_at") val postedAt: String? = null,
    val note: String = "",
    @ColumnInfo(name = "occurred_at") val occurredAt: String? = null,
    val origin: String = "shop",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

@Entity(
    tableName = "reservations",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["status"]),
    ],
)
data class ReservationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "customer_id") val customerId: Int? = null,
    @ColumnInfo(name = "customer_name") val customerName: String? = null,
    /** JSON text, default '[]'. */
    @ColumnInfo(name = "items_json") val itemsJson: String = "[]",
    val amount: Double? = 0.0,
    val status: String = "open",
    @ColumnInfo(name = "fulfilled_order_id") val fulfilledOrderId: Int? = null,
    @ColumnInfo(name = "created_by_user_id") val createdByUserId: Int? = null,
    val note: String = "",
    val origin: String = "shop",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "taken_by_name") val takenByName: String? = null,
)

// ---------------------------------------------------------------------------
// Stock ledger: stock_movements, stock_levels
// ---------------------------------------------------------------------------

@Entity(
    tableName = "stock_movements",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["shop_id", "item_id", "occurred_at"]),
    ],
)
data class StockMovementEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "item_id") val itemId: Int? = null,
    val kind: String = "",
    val qty: Double? = 0.0,
    @ColumnInfo(name = "qty_after") val qtyAfter: Double? = null,
    @ColumnInfo(name = "ref_table") val refTable: String? = null,
    @ColumnInfo(name = "ref_id") val refId: Int? = null,
    @ColumnInfo(name = "warehouse_id") val warehouseId: Int? = null,
    val note: String = "",
    @ColumnInfo(name = "occurred_at") val occurredAt: String? = null,
    @ColumnInfo(name = "created_by_user_id") val createdByUserId: Int? = null,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "location_id") val locationId: Int? = null,
)

@Entity(
    tableName = "stock_levels",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["product_id"]),
    ],
)
data class StockLevelEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "warehouse_id") val warehouseId: Int? = null,
    @ColumnInfo(name = "product_id") val productId: Int? = null,
    val qty: Double? = 0.0,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

// ---------------------------------------------------------------------------
// Price lists
// ---------------------------------------------------------------------------

@Entity(
    tableName = "price_lists",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class PriceListEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    val code: String? = null,
    @ColumnInfo(name = "is_default") val isDefault: Boolean = false,
    @ColumnInfo(name = "markup_pct") val markupPct: Double? = 0.0,
    @ColumnInfo(name = "rounding_mode") val roundingMode: String = "none",
    @ColumnInfo(name = "rounding_value") val roundingValue: Double? = 0.0,
    val active: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

/**
 * No uuid column — the pull upserts on the natural key
 * (price_list_id, product_id), backed by the UNIQUE index below.
 */
@Entity(
    tableName = "price_list_items",
    indices = [
        Index(value = ["price_list_id", "product_id"], unique = true),
    ],
)
data class PriceListItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "price_list_id") val priceListId: Int? = null,
    @ColumnInfo(name = "product_id") val productId: Int? = null,
    val price: Double? = null,
    @ColumnInfo(name = "min_qty") val minQty: Double? = null,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

/**
 * No uuid column — the pull upserts on the natural key
 * (party_type, party_id, price_list_id).
 */
@Entity(
    tableName = "party_price_lists",
    indices = [
        Index(value = ["party_type", "party_id", "price_list_id"], unique = true),
        Index(value = ["party_type", "party_id"]),
    ],
)
data class PartyPriceListEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "party_type") val partyType: String = "",
    @ColumnInfo(name = "party_id") val partyId: Int? = null,
    @ColumnInfo(name = "price_list_id") val priceListId: Int? = null,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

/**
 * No uuid column — the pull upserts on the natural key
 * (party_type, party_id, product_id).
 */
@Entity(
    tableName = "party_prices",
    indices = [
        Index(value = ["party_type", "party_id", "product_id"], unique = true),
        Index(value = ["party_type", "party_id"]),
    ],
)
data class PartyPriceEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "party_type") val partyType: String = "",
    @ColumnInfo(name = "party_id") val partyId: Int? = null,
    @ColumnInfo(name = "product_id") val productId: Int? = null,
    val price: Double? = 0.0,
    val note: String = "",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

// ---------------------------------------------------------------------------
// Customer groups, units, warehouses
// ---------------------------------------------------------------------------

@Entity(
    tableName = "customer_groups",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["shop_id", "active"]),
    ],
)
data class CustomerGroupEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    val code: String? = null,
    @ColumnInfo(name = "price_tier") val priceTier: String = "returning",
    @ColumnInfo(name = "price_list_id") val priceListId: Int? = null,
    @ColumnInfo(name = "credit_days") val creditDays: Int? = 0,
    @ColumnInfo(name = "credit_limit") val creditLimit: Double? = 0.0,
    val colour: String? = null,
    val active: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

@Entity(
    tableName = "units",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class UnitEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    val plural: String? = null,
    val abbreviation: String? = null,
    val dimension: String = "count",
    @ColumnInfo(name = "decimal_places") val decimalPlaces: Int? = 0,
    @ColumnInfo(name = "litres_each") val litresEach: Double? = null,
    val active: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

@Entity(
    tableName = "unit_conversions",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["from_unit_id", "to_unit_id"]),
    ],
)
data class UnitConversionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "from_unit_id") val fromUnitId: Int? = null,
    @ColumnInfo(name = "to_unit_id") val toUnitId: Int? = null,
    val multiplier: Double? = 0.0,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
)

@Entity(
    tableName = "warehouses",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class WarehouseEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    val code: String? = null,
    val address: String? = null,
    @ColumnInfo(name = "is_default") val isDefault: Boolean = false,
    val active: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

@Entity(
    tableName = "warehouse_locations",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class WarehouseLocationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String? = null,
    @ColumnInfo(name = "warehouse_id") val warehouseId: Int? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    val code: String? = null,
    val kind: String = "rack",
    val active: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

// ---------------------------------------------------------------------------
// Sync bookkeeping
// ---------------------------------------------------------------------------

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val key: String = "",
    val value: String? = null,
)

@Entity(
    tableName = "sync_outbox",
    indices = [Index(value = ["queued_at"])],
)
data class SyncOutboxEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "table_name") val tableName: String = "",
    @ColumnInfo(name = "row_uuid") val rowUuid: String = "",
    val op: String = "insert",
    /** Full row as JSON text, minus `id` (the server owns `id`). */
    val payload: String = "",
    @ColumnInfo(name = "queued_at") val queuedAt: String? = null,
    val attempts: Int = 0,
    @ColumnInfo(name = "last_error") val lastError: String? = null,
)
