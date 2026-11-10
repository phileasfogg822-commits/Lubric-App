package app.lubric.desktop.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/**
 * One DAO per table. Every DAO exposes at minimum `upsert` (INSERT OR
 * REPLACE) and `count()`.
 *
 * Why `getByUuid` exists on the uuid tables: Room's REPLACE resolves a
 * conflict on any UNIQUE constraint, so re-pulling a row would delete the
 * old row and insert a fresh one with a NEW local `id` — orphaning local
 * child rows that point at the old id (e.g. order_items -> orders.id).
 * [app.lubric.desktop.data.sync.PullApplier] therefore looks the row up by
 * uuid first and reuses its local id before upserting, so a pull is a
 * true update in place (the web app's `ON CONFLICT(uuid) DO UPDATE`).
 * The three uuid-less tables get an equivalent natural-key lookup.
 */

@Dao
interface ShopDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: ShopEntity)

    @Query("SELECT COUNT(*) FROM shops")
    suspend fun count(): Int
}

@Dao
interface UserDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: UserEntity)

    @Query("SELECT COUNT(*) FROM users")
    suspend fun count(): Int
}

@Dao
interface RolePermissionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: RolePermissionEntity)

    @Query("SELECT COUNT(*) FROM role_permissions")
    suspend fun count(): Int
}

@Dao
interface SettingDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: SettingEntity)

    @Query("SELECT COUNT(*) FROM settings")
    suspend fun count(): Int
}

@Dao
interface CategoryDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: CategoryEntity)

    @Query("SELECT * FROM categories WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): CategoryEntity?

    @Query("SELECT COUNT(*) FROM categories")
    suspend fun count(): Int
}

@Dao
interface BrandDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: BrandEntity)

    @Query("SELECT * FROM brands WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): BrandEntity?

    @Query("SELECT COUNT(*) FROM brands")
    suspend fun count(): Int
}

@Dao
interface ProductDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: ProductEntity)

    @Query("SELECT * FROM products WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): ProductEntity?

    @Query("SELECT COUNT(*) FROM products")
    suspend fun count(): Int
}

@Dao
interface ServiceDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: ServiceEntity)

    @Query("SELECT * FROM services WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): ServiceEntity?

    @Query("SELECT COUNT(*) FROM services")
    suspend fun count(): Int
}

@Dao
interface ContainerDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: ContainerEntity)

    @Query("SELECT COUNT(*) FROM containers")
    suspend fun count(): Int
}

@Dao
interface ContainerSplitDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: ContainerSplitEntity)

    @Query("SELECT COUNT(*) FROM container_splits")
    suspend fun count(): Int
}

@Dao
interface CustomerDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: CustomerEntity)

    @Query("SELECT * FROM customers WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): CustomerEntity?

    @Query("SELECT COUNT(*) FROM customers")
    suspend fun count(): Int
}

@Dao
interface VehicleDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: VehicleEntity)

    @Query("SELECT * FROM vehicles WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): VehicleEntity?

    @Query("SELECT COUNT(*) FROM vehicles")
    suspend fun count(): Int
}

@Dao
interface VendorDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: VendorEntity)

    @Query("SELECT * FROM vendors WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): VendorEntity?

    @Query("SELECT COUNT(*) FROM vendors")
    suspend fun count(): Int
}

@Dao
interface VendorPayableDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: VendorPayableEntity)

    @Query("SELECT * FROM vendor_payables WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): VendorPayableEntity?

    @Query("SELECT COUNT(*) FROM vendor_payables")
    suspend fun count(): Int
}

@Dao
interface AccountDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: AccountEntity)

    @Query("SELECT * FROM accounts WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): AccountEntity?

    @Query("SELECT COUNT(*) FROM accounts")
    suspend fun count(): Int
}

@Dao
interface AccountTransactionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: AccountTransactionEntity)

    @Query("SELECT * FROM account_transactions WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): AccountTransactionEntity?

    @Query("SELECT COUNT(*) FROM account_transactions")
    suspend fun count(): Int
}

@Dao
interface OrderDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: OrderEntity)

    @Query("SELECT * FROM orders WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): OrderEntity?

    @Query("SELECT COUNT(*) FROM orders")
    suspend fun count(): Int
}

@Dao
interface OrderItemDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: OrderItemEntity)

    @Query("SELECT * FROM order_items WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): OrderItemEntity?

    @Query("SELECT COUNT(*) FROM order_items")
    suspend fun count(): Int
}

@Dao
interface UsedOilDrumDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: UsedOilDrumEntity)

    @Query("SELECT COUNT(*) FROM used_oil_drum")
    suspend fun count(): Int
}

@Dao
interface UsedOilLogDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: UsedOilLogEntity)

    @Query("SELECT COUNT(*) FROM used_oil_log")
    suspend fun count(): Int
}

@Dao
interface ExpenseDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: ExpenseEntity)

    @Query("SELECT * FROM expenses WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): ExpenseEntity?

    @Query("SELECT COUNT(*) FROM expenses")
    suspend fun count(): Int
}

@Dao
interface PurchaseOrderDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: PurchaseOrderEntity)

    @Query("SELECT * FROM purchase_orders WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): PurchaseOrderEntity?

    @Query("SELECT COUNT(*) FROM purchase_orders")
    suspend fun count(): Int
}

@Dao
interface PurchaseOrderItemDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: PurchaseOrderItemEntity)

    @Query("SELECT COUNT(*) FROM purchase_order_items")
    suspend fun count(): Int
}

@Dao
interface ReminderDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: ReminderEntity)

    @Query("SELECT * FROM reminders WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): ReminderEntity?

    @Query("SELECT COUNT(*) FROM reminders")
    suspend fun count(): Int
}

@Dao
interface InspectionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: InspectionEntity)

    @Query("SELECT * FROM inspections WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): InspectionEntity?

    @Query("SELECT COUNT(*) FROM inspections")
    suspend fun count(): Int
}

@Dao
interface CommitmentDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: CommitmentEntity)

    @Query("SELECT * FROM commitments WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): CommitmentEntity?

    @Query("SELECT COUNT(*) FROM commitments")
    suspend fun count(): Int
}

@Dao
interface CommitmentItemDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: CommitmentItemEntity)

    @Query("SELECT * FROM commitment_items WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): CommitmentItemEntity?

    @Query("SELECT COUNT(*) FROM commitment_items")
    suspend fun count(): Int
}

@Dao
interface PartyLedgerDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: PartyLedgerEntity)

    @Query("SELECT * FROM party_ledger WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): PartyLedgerEntity?

    @Query("SELECT COUNT(*) FROM party_ledger")
    suspend fun count(): Int
}

@Dao
interface PayableAllocationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: PayableAllocationEntity)

    @Query("SELECT COUNT(*) FROM payable_allocations")
    suspend fun count(): Int
}

@Dao
interface CashMovementDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: CashMovementEntity)

    @Query("SELECT * FROM cash_movements WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): CashMovementEntity?

    @Query("SELECT COUNT(*) FROM cash_movements")
    suspend fun count(): Int
}

@Dao
interface ReservationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: ReservationEntity)

    @Query("SELECT * FROM reservations WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): ReservationEntity?

    @Query("SELECT COUNT(*) FROM reservations")
    suspend fun count(): Int
}

@Dao
interface StockMovementDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: StockMovementEntity)

    @Query("SELECT * FROM stock_movements WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): StockMovementEntity?

    @Query("SELECT COUNT(*) FROM stock_movements")
    suspend fun count(): Int
}

@Dao
interface StockLevelDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: StockLevelEntity)

    @Query("SELECT * FROM stock_levels WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): StockLevelEntity?

    @Query("SELECT COUNT(*) FROM stock_levels")
    suspend fun count(): Int
}

@Dao
interface PriceListDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: PriceListEntity)

    @Query("SELECT * FROM price_lists WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): PriceListEntity?

    @Query("SELECT COUNT(*) FROM price_lists")
    suspend fun count(): Int
}

@Dao
interface PriceListItemDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: PriceListItemEntity)

    @Query(
        "SELECT * FROM price_list_items " +
            "WHERE price_list_id = :priceListId AND product_id = :productId LIMIT 1",
    )
    suspend fun getByNaturalKey(priceListId: Int?, productId: Int?): PriceListItemEntity?

    @Query("SELECT COUNT(*) FROM price_list_items")
    suspend fun count(): Int
}

@Dao
interface PartyPriceListDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: PartyPriceListEntity)

    @Query(
        "SELECT * FROM party_price_lists " +
            "WHERE party_type = :partyType AND party_id = :partyId " +
            "AND price_list_id = :priceListId LIMIT 1",
    )
    suspend fun getByNaturalKey(
        partyType: String,
        partyId: Int?,
        priceListId: Int?,
    ): PartyPriceListEntity?

    @Query("SELECT COUNT(*) FROM party_price_lists")
    suspend fun count(): Int
}

@Dao
interface PartyPriceDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: PartyPriceEntity)

    @Query(
        "SELECT * FROM party_prices " +
            "WHERE party_type = :partyType AND party_id = :partyId " +
            "AND product_id = :productId LIMIT 1",
    )
    suspend fun getByNaturalKey(
        partyType: String,
        partyId: Int?,
        productId: Int?,
    ): PartyPriceEntity?

    @Query("SELECT COUNT(*) FROM party_prices")
    suspend fun count(): Int
}

@Dao
interface CustomerGroupDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: CustomerGroupEntity)

    @Query("SELECT * FROM customer_groups WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): CustomerGroupEntity?

    @Query("SELECT COUNT(*) FROM customer_groups")
    suspend fun count(): Int
}

@Dao
interface UnitDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: UnitEntity)

    @Query("SELECT * FROM units WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): UnitEntity?

    @Query("SELECT COUNT(*) FROM units")
    suspend fun count(): Int
}

@Dao
interface UnitConversionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: UnitConversionEntity)

    @Query("SELECT * FROM unit_conversions WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): UnitConversionEntity?

    @Query("SELECT COUNT(*) FROM unit_conversions")
    suspend fun count(): Int
}

@Dao
interface WarehouseDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: WarehouseEntity)

    @Query("SELECT * FROM warehouses WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): WarehouseEntity?

    @Query("SELECT COUNT(*) FROM warehouses")
    suspend fun count(): Int
}

@Dao
interface WarehouseLocationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: WarehouseLocationEntity)

    @Query("SELECT * FROM warehouse_locations WHERE uuid = :uuid LIMIT 1")
    suspend fun getByUuid(uuid: String): WarehouseLocationEntity?

    @Query("SELECT COUNT(*) FROM warehouse_locations")
    suspend fun count(): Int
}

// ---------------------------------------------------------------------------
// Sync bookkeeping DAOs
// ---------------------------------------------------------------------------

@Dao
interface SyncStateDao {
    @Query("SELECT value FROM sync_state WHERE key = :key LIMIT 1")
    suspend fun getValue(key: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: SyncStateEntity)

    /** The pull cursor, stored as text in sync_state. Defaults to 0. */
    suspend fun getPullCursor(): Long = getValue("pull_cursor")?.toLongOrNull() ?: 0L

    suspend fun setPullCursor(cursor: Long) {
        upsert(SyncStateEntity("pull_cursor", cursor.toString()))
    }
}

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(row: SyncOutboxEntity): Long

    /** Oldest-first batch for one push round (sync.ts caps at 200). */
    @Query("SELECT * FROM sync_outbox ORDER BY id LIMIT :limit")
    suspend fun getBatch(limit: Int): List<SyncOutboxEntity>

    @Query("DELETE FROM sync_outbox WHERE id = :id")
    suspend fun deleteById(id: Long)

    /** Keep a server-rejected row for a later round, with its error noted. */
    @Query(
        "UPDATE sync_outbox SET attempts = attempts + 1, last_error = :error " +
            "WHERE id = :id",
    )
    suspend fun markRejected(id: Long, error: String)

    @Query("SELECT COUNT(*) FROM sync_outbox")
    suspend fun count(): Int
}
