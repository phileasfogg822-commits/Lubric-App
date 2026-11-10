package app.lubric.desktop.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entities mirroring the web app's local SQLite schema
 * (`src/lib/localDb.ts`: LOCAL_SCHEMA parts 1-9 + SYNC_COLUMN_PATCHES).
 *
 * Column names match the web schema exactly. Types: TEXT -> String?,
 * REAL -> Double?, INTEGER -> Int?, booleans -> Boolean? (Room stores 0/1).
 * JSON-ish TEXT columns (inspections data/inspection_data, users permissions,
 * reservations items_json) hold raw JSON text.
 *
 * Every table has an autoincrement Long id as its primary key, except
 * [RolePermissionEntity] (composite natural key, as in the web schema),
 * [SettingEntity] and [SyncStateEntity] (TEXT key primary key, as in the
 * web schema). `uuid` carries a UNIQUE index on every table that has one,
 * mirroring the web schema's idx_<table>_uuid indexes; the three uuid-less
 * tables use UNIQUE indexes on their natural keys instead.
 */

// ---------------------------------------------------------------------------
// Local-only: shops, users, role_permissions, settings
// ---------------------------------------------------------------------------

@Entity(tableName = "shops")
data class ShopEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String = "Zafar Lubricants",
    val address: String = "",
    val phone: String = "",
    val currency: String = "PKR",
    val language: String = "en",
    @ColumnInfo(name = "used_oil_drum_capacity") val usedOilDrumCapacity: Double = 200.0,
    @ColumnInfo(name = "manual_price_allowed") val manualPriceAllowed: Boolean = false,
    @ColumnInfo(name = "wholesale_mode") val wholesaleMode: String = "auto",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
)

@Entity(tableName = "users")
data class UserEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val email: String = "",
    // NEVER populated from the server: /api/auth/me returns password_hash
    // but the client must not store or display it. Kept as a column only so
    // the local schema mirrors the web schema; always stays null locally.
    @ColumnInfo(name = "password_hash") val passwordHash: String? = null,
    @ColumnInfo(name = "full_name") val fullName: String = "",
    val role: String = "cashier",
    /** JSON text, e.g. '["pos.create","customers"]'. */
    val permissions: String? = "[]",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
)

@Entity(tableName = "role_permissions", primaryKeys = ["role", "permission_key"])
data class RolePermissionEntity(
    val role: String = "",
    @ColumnInfo(name = "permission_key") val permissionKey: String = "",
)

@Entity(tableName = "settings")
data class SettingEntity(
    @PrimaryKey val key: String = "",
    val value: String? = null,
)

// ---------------------------------------------------------------------------
// Master lists
// ---------------------------------------------------------------------------

@Entity(
    tableName = "categories",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class CategoryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

@Entity(
    tableName = "brands",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class BrandEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

// ---------------------------------------------------------------------------
// Catalog: products, services, containers
// ---------------------------------------------------------------------------

@Entity(
    tableName = "products",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["category_id"]),
    ],
)
data class ProductEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val sku: String? = null,
    val barcode: String? = null,
    val name: String = "",
    @ColumnInfo(name = "brand_id") val brandId: Int? = null,
    @ColumnInfo(name = "category_id") val categoryId: Int? = null,
    val packing: String = "",
    val unit: String = "piece",
    val variant: String = "",
    @ColumnInfo(name = "mfd_date") val mfdDate: String = "",
    @ColumnInfo(name = "exp_date") val expDate: String = "",
    val offer: String = "",
    @ColumnInfo(name = "cost_price") val costPrice: Double? = 0.0,
    @ColumnInfo(name = "stock_qty") val stockQty: Double? = 0.0,
    @ColumnInfo(name = "low_stock_threshold") val lowStockThreshold: Double? = 5.0,
    @ColumnInfo(name = "price_returning") val priceReturning: Double? = 0.0,
    @ColumnInfo(name = "price_walking") val priceWalking: Double? = null,
    @ColumnInfo(name = "price_wholesale") val priceWholesale: Double? = 0.0,
    @ColumnInfo(name = "wholesale_min_qty") val wholesaleMinQty: Double? = 10.0,
    val active: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "vendor_id") val vendorId: Int? = null,
    @ColumnInfo(name = "received_date") val receivedDate: String? = null,
    @ColumnInfo(name = "unit_id") val unitId: Int? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "deleted_at") val deletedAt: String? = null,
)

@Entity(
    tableName = "services",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class ServiceEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    val price: Double? = 0.0,
    val active: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "deleted_at") val deletedAt: String? = null,
)

@Entity(tableName = "containers")
data class ContainerEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "product_id") val productId: Int? = null,
    val barcode: String? = null,
    @ColumnInfo(name = "original_volume") val originalVolume: Double? = 0.0,
    @ColumnInfo(name = "remaining_volume") val remainingVolume: Double? = 0.0,
    val status: String = "opened",
    @ColumnInfo(name = "opened_at") val openedAt: String? = null,
    @ColumnInfo(name = "source_order_id") val sourceOrderId: Int? = null,
)

@Entity(tableName = "container_splits")
data class ContainerSplitEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "container_id") val containerId: Int? = null,
    @ColumnInfo(name = "sold_qty") val soldQty: Double? = 0.0,
    @ColumnInfo(name = "sold_at") val soldAt: String? = null,
    @ColumnInfo(name = "order_id") val orderId: Int? = null,
)

// ---------------------------------------------------------------------------
// Parties: customers, vehicles, vendors, vendor_payables
// ---------------------------------------------------------------------------

@Entity(
    tableName = "customers",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class CustomerEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    val phone: String = "",
    @ColumnInfo(name = "customer_type") val customerType: String = "returning",
    @ColumnInfo(name = "credit_balance") val creditBalance: Double? = 0.0,
    @ColumnInfo(name = "last_visit_at") val lastVisitAt: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "group_id") val groupId: Int? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "deleted_at") val deletedAt: String? = null,
)

@Entity(
    tableName = "vehicles",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["customer_id"]),
    ],
)
data class VehicleEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "customer_id") val customerId: Int? = null,
    val registration: String = "",
    val make: String = "",
    val model: String = "",
    @ColumnInfo(name = "model_year") val modelYear: String = "",
    val color: String = "",
    val condition: String = "",
    @ColumnInfo(name = "oil_capacity") val oilCapacity: Double? = 0.0,
    val mileage: Int? = 0,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "service_interval_days") val serviceIntervalDays: Int? = null,
    @ColumnInfo(name = "service_interval_km") val serviceIntervalKm: Int? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "deleted_at") val deletedAt: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
)

@Entity(
    tableName = "vendors",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class VendorEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    val contact: String = "",
    val phone: String = "",
    @ColumnInfo(name = "payable_balance") val payableBalance: Double? = 0.0,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "deleted_at") val deletedAt: String? = null,
)

@Entity(
    tableName = "vendor_payables",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class VendorPayableEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "vendor_id") val vendorId: Int? = null,
    val amount: Double? = 0.0,
    @ColumnInfo(name = "due_date") val dueDate: String? = null,
    val status: String = "pending",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

// ---------------------------------------------------------------------------
// Money: accounts, account_transactions
// ---------------------------------------------------------------------------

@Entity(
    tableName = "accounts",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class AccountEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val name: String = "",
    val type: String = "cash",
    val balance: Double? = 0.0,
    val active: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "account_class") val accountClass: String? = null,
    val code: String? = null,
)

@Entity(
    tableName = "account_transactions",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class AccountTransactionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "account_id") val accountId: Int? = null,
    val amount: Double? = 0.0,
    val type: String = "in",
    val reference: String = "",
    @ColumnInfo(name = "related_account_id") val relatedAccountId: Int? = null,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
)

// ---------------------------------------------------------------------------
// Sales: orders, order_items
// ---------------------------------------------------------------------------

@Entity(
    tableName = "orders",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["customer_id"]),
    ],
)
data class OrderEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "customer_id") val customerId: Int? = null,
    @ColumnInfo(name = "user_id") val userId: Int? = null,
    val total: Double? = 0.0,
    @ColumnInfo(name = "paid_amount") val paidAmount: Double? = 0.0,
    @ColumnInfo(name = "payment_account_id") val paymentAccountId: Int? = null,
    @ColumnInfo(name = "payment_method") val paymentMethod: String = "cash",
    val status: String = "completed",
    @ColumnInfo(name = "vehicle_id") val vehicleId: Int? = null,
    val mileage: Int? = 0,
    val notes: String = "",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "converted_from_commitment_id") val convertedFromCommitmentId: Int? = null,
)

@Entity(
    tableName = "order_items",
    indices = [
        Index(value = ["uuid"], unique = true),
        Index(value = ["order_id"]),
    ],
)
data class OrderItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "order_id") val orderId: Int? = null,
    val kind: String = "",
    @ColumnInfo(name = "ref_id") val refId: Int? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "product_name") val productName: String = "",
    val qty: Double? = 1.0,
    @ColumnInfo(name = "unit_price") val unitPrice: Double? = 0.0,
    @ColumnInfo(name = "line_total") val lineTotal: Double? = 0.0,
    @ColumnInfo(name = "container_id") val containerId: Int? = null,
    val capacity: Double? = 0.0,
    @ColumnInfo(name = "leftover_litres") val leftoverLitres: Double? = 0.0,
    @ColumnInfo(name = "leftover_to") val leftoverTo: String = "customer",
    @ColumnInfo(name = "leftover_released") val leftoverReleased: Boolean = false,
    @ColumnInfo(name = "billed_by_capacity") val billedByCapacity: Boolean = false,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

// ---------------------------------------------------------------------------
// Used oil
// ---------------------------------------------------------------------------

@Entity(tableName = "used_oil_drum")
data class UsedOilDrumEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "current_litres") val currentLitres: Double? = 0.0,
    val capacity: Double? = 200.0,
)

@Entity(tableName = "used_oil_log")
data class UsedOilLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "drum_id") val drumId: Int? = null,
    val litres: Double? = 0.0,
    val type: String = "added",
    @ColumnInfo(name = "source_order_id") val sourceOrderId: Int? = null,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
)

// ---------------------------------------------------------------------------
// Expenses, purchases, reminders, inspections
// ---------------------------------------------------------------------------

@Entity(
    tableName = "expenses",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class ExpenseEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val category: String = "",
    val subcategory: String = "",
    val amount: Double? = 0.0,
    @ColumnInfo(name = "account_id") val accountId: Int? = null,
    val date: String? = null,
    val note: String = "",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    @ColumnInfo(name = "deleted_at") val deletedAt: String? = null,
)

@Entity(
    tableName = "purchase_orders",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class PurchaseOrderEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "vendor_id") val vendorId: Int? = null,
    val total: Double? = 0.0,
    val paid: Double? = 0.0,
    val status: String = "completed",
    val notes: String = "",
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)

@Entity(tableName = "purchase_order_items")
data class PurchaseOrderItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "order_id") val orderId: Int? = null,
    @ColumnInfo(name = "product_name") val productName: String = "",
    val qty: Double? = 0.0,
    @ColumnInfo(name = "unit_cost") val unitCost: Double? = 0.0,
    @ColumnInfo(name = "line_total") val lineTotal: Double? = 0.0,
)

@Entity(
    tableName = "reminders",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class ReminderEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    val kind: String = "todo",
    val title: String = "",
    val details: String = "",
    @ColumnInfo(name = "due_at") val dueAt: String? = null,
    @ColumnInfo(name = "due_km") val dueKm: Int? = null,
    @ColumnInfo(name = "last_mileage") val lastMileage: Int? = null,
    @ColumnInfo(name = "customer_id") val customerId: Int? = null,
    @ColumnInfo(name = "vehicle_id") val vehicleId: Int? = null,
    @ColumnInfo(name = "vendor_id") val vendorId: Int? = null,
    @ColumnInfo(name = "order_id") val orderId: Int? = null,
    val priority: String = "normal",
    @ColumnInfo(name = "recurrence_days") val recurrenceDays: Int? = null,
    val status: String = "pending",
    @ColumnInfo(name = "completed_at") val completedAt: String? = null,
    @ColumnInfo(name = "created_by_user_id") val createdByUserId: Int? = null,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
    val uuid: String? = null,
)

@Entity(
    tableName = "inspections",
    indices = [Index(value = ["uuid"], unique = true)],
)
data class InspectionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shop_id") val shopId: Int? = 1,
    @ColumnInfo(name = "customer_id") val customerId: Int? = null,
    @ColumnInfo(name = "vehicle_id") val vehicleId: Int? = null,
    // Legacy local column (base schema). The server column is inspection_data.
    val data: String = "",
    val notes: String = "",
    @ColumnInfo(name = "user_id") val userId: Int? = null,
    @ColumnInfo(name = "created_at") val createdAt: String? = null,
    @ColumnInfo(name = "order_id") val orderId: Int? = null,
    /** JSON text holding the inspection object (server JSONB column). */
    @ColumnInfo(name = "inspection_data") val inspectionData: String? = null,
    val uuid: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String? = null,
)
