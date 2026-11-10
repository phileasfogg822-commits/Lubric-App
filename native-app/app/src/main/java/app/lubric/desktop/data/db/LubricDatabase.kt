package app.lubric.desktop.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import app.lubric.desktop.data.accounts.AccountQueriesDao
import app.lubric.desktop.data.expenses.ExpenseQueriesDao
import app.lubric.desktop.data.field.FieldQueriesDao
import app.lubric.desktop.data.inspections.InspectionQueriesDao
import app.lubric.desktop.data.purchases.PurchaseQueriesDao
import app.lubric.desktop.data.reminders.ReminderQueriesDao
import app.lubric.desktop.data.reports.ReportQueriesDao
import app.lubric.desktop.data.shop.ShopQueriesDao
import app.lubric.desktop.data.team.TeamQueriesDao
import app.lubric.desktop.data.transactions.TransactionQueriesDao
import app.lubric.desktop.data.vendors.VendorQueriesDao

/**
 * The local Room database ("lubric", version 1), mirroring the web app's
 * local SQLite schema (`src/lib/localDb.ts`) for all 30 sync tables plus
 * the local-only tables.
 *
 * Seed on first create (mirrors LOCAL_SEED in localDb.ts): shop 1
 * "Zafar Lubricants" (PKR), accounts 1 "Shop Cash Drawer" (cash) + 2
 * "Bank Account" (bank), used_oil_drum 1 (capacity 200), setting
 * used_oil_drum_capacity=200, sync_state pull_cursor='0'.
 *
 * Outbox triggers are created on create and re-created on every open
 * (idempotent), so a crash mid-pull — which drops them — still leaves them
 * restored on the next launch.
 */
@Database(
    entities = [
        ShopEntity::class,
        UserEntity::class,
        RolePermissionEntity::class,
        SettingEntity::class,
        CategoryEntity::class,
        BrandEntity::class,
        ProductEntity::class,
        ServiceEntity::class,
        ContainerEntity::class,
        ContainerSplitEntity::class,
        CustomerEntity::class,
        VehicleEntity::class,
        VendorEntity::class,
        VendorPayableEntity::class,
        AccountEntity::class,
        AccountTransactionEntity::class,
        OrderEntity::class,
        OrderItemEntity::class,
        UsedOilDrumEntity::class,
        UsedOilLogEntity::class,
        ExpenseEntity::class,
        PurchaseOrderEntity::class,
        PurchaseOrderItemEntity::class,
        ReminderEntity::class,
        InspectionEntity::class,
        CommitmentEntity::class,
        CommitmentItemEntity::class,
        PartyLedgerEntity::class,
        PayableAllocationEntity::class,
        CashMovementEntity::class,
        ReservationEntity::class,
        StockMovementEntity::class,
        StockLevelEntity::class,
        PriceListEntity::class,
        PriceListItemEntity::class,
        PartyPriceListEntity::class,
        PartyPriceEntity::class,
        CustomerGroupEntity::class,
        UnitEntity::class,
        UnitConversionEntity::class,
        WarehouseEntity::class,
        WarehouseLocationEntity::class,
        SyncStateEntity::class,
        SyncOutboxEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class LubricDatabase : RoomDatabase() {

    abstract fun shopDao(): ShopDao
    abstract fun userDao(): UserDao
    abstract fun rolePermissionDao(): RolePermissionDao
    abstract fun settingDao(): SettingDao
    abstract fun categoryDao(): CategoryDao
    abstract fun brandDao(): BrandDao
    abstract fun productDao(): ProductDao
    abstract fun serviceDao(): ServiceDao
    abstract fun containerDao(): ContainerDao
    abstract fun containerSplitDao(): ContainerSplitDao
    abstract fun customerDao(): CustomerDao
    abstract fun vehicleDao(): VehicleDao
    abstract fun vendorDao(): VendorDao
    abstract fun vendorPayableDao(): VendorPayableDao
    abstract fun accountDao(): AccountDao
    abstract fun accountTransactionDao(): AccountTransactionDao
    abstract fun orderDao(): OrderDao
    abstract fun orderItemDao(): OrderItemDao
    abstract fun usedOilDrumDao(): UsedOilDrumDao
    abstract fun usedOilLogDao(): UsedOilLogDao
    abstract fun expenseDao(): ExpenseDao
    abstract fun purchaseOrderDao(): PurchaseOrderDao
    abstract fun purchaseOrderItemDao(): PurchaseOrderItemDao
    abstract fun reminderDao(): ReminderDao
    abstract fun inspectionDao(): InspectionDao
    abstract fun commitmentDao(): CommitmentDao
    abstract fun commitmentItemDao(): CommitmentItemDao
    abstract fun partyLedgerDao(): PartyLedgerDao
    abstract fun payableAllocationDao(): PayableAllocationDao
    abstract fun cashMovementDao(): CashMovementDao
    abstract fun reservationDao(): ReservationDao
    abstract fun stockMovementDao(): StockMovementDao
    abstract fun stockLevelDao(): StockLevelDao
    abstract fun priceListDao(): PriceListDao
    abstract fun priceListItemDao(): PriceListItemDao
    abstract fun partyPriceListDao(): PartyPriceListDao
    abstract fun partyPriceDao(): PartyPriceDao
    abstract fun customerGroupDao(): CustomerGroupDao
    abstract fun unitDao(): UnitDao
    abstract fun unitConversionDao(): UnitConversionDao
    abstract fun warehouseDao(): WarehouseDao
    abstract fun warehouseLocationDao(): WarehouseLocationDao
    abstract fun syncStateDao(): SyncStateDao
    abstract fun outboxDao(): OutboxDao

    // Phase 3 query DAOs (one per screen area; registered here so Room
    // generates their implementations).
    abstract fun purchaseQueriesDao(): PurchaseQueriesDao
    abstract fun inspectionQueriesDao(): InspectionQueriesDao
    abstract fun accountQueriesDao(): AccountQueriesDao
    abstract fun expenseQueriesDao(): ExpenseQueriesDao
    abstract fun teamQueriesDao(): TeamQueriesDao
    abstract fun shopQueriesDao(): ShopQueriesDao
    abstract fun vendorQueriesDao(): VendorQueriesDao
    abstract fun reportQueriesDao(): ReportQueriesDao
    abstract fun reminderQueriesDao(): ReminderQueriesDao
    abstract fun transactionQueriesDao(): TransactionQueriesDao
    abstract fun fieldQueriesDao(): FieldQueriesDao

    /** Drop the outbox triggers (before a pull). */
    fun dropOutboxTriggers() {
        OutboxTriggers.drop(openHelper.writableDatabase)
    }

    /** (Re)create the outbox triggers (after a pull, in a finally block). */
    fun createOutboxTriggers() {
        OutboxTriggers.create(openHelper.writableDatabase)
    }

    companion object {
        const val DATABASE_NAME = "lubric"

        fun build(context: Context): LubricDatabase =
            Room.databaseBuilder(context, LubricDatabase::class.java, DATABASE_NAME)
                .addCallback(object : Callback() {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        super.onCreate(db)
                        db.execSQL(
                            "INSERT OR IGNORE INTO shops (id, name, currency) " +
                                "VALUES (1, 'Zafar Lubricants', 'PKR')",
                        )
                        db.execSQL(
                            "INSERT OR IGNORE INTO accounts (id, name, type) " +
                                "VALUES (1, 'Shop Cash Drawer', 'cash')",
                        )
                        db.execSQL(
                            "INSERT OR IGNORE INTO accounts (id, name, type) " +
                                "VALUES (2, 'Bank Account', 'bank')",
                        )
                        db.execSQL(
                            "INSERT OR IGNORE INTO used_oil_drum (id, capacity) " +
                                "VALUES (1, 200)",
                        )
                        db.execSQL(
                            "INSERT OR IGNORE INTO settings (key, value) " +
                                "VALUES ('used_oil_drum_capacity', '200')",
                        )
                        db.execSQL(
                            "INSERT OR IGNORE INTO sync_state (key, value) " +
                                "VALUES ('pull_cursor', '0')",
                        )
                        OutboxTriggers.create(db)
                    }

                    override fun onOpen(db: SupportSQLiteDatabase) {
                        super.onOpen(db)
                        // Idempotent: restores the triggers even if a previous
                        // run died mid-pull with them dropped.
                        OutboxTriggers.create(db)
                    }
                })
                .build()
    }
}
