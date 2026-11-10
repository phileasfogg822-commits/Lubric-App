package app.lubric.desktop.data.sync

import android.content.Context
import androidx.room.withTransaction
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.SyncTables
import app.lubric.desktop.data.network.LubricApi
import app.lubric.desktop.data.network.PairRequest
import app.lubric.desktop.data.network.PushChange
import app.lubric.desktop.data.network.PushRequest
import app.lubric.desktop.data.store.TokenStore
import com.google.gson.JsonParser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import retrofit2.HttpException
import java.time.Instant
import java.util.concurrent.TimeUnit

enum class SyncStatus { OFFLINE, SYNCING, IDLE, ERROR }

data class SyncState(
    val status: SyncStatus = SyncStatus.OFFLINE,
    val lastError: String = "",
    val lastSyncAt: String? = null,
    val pushed: Int = 0,
    val pulled: Int = 0,
    val rejected: Int = 0,
)

data class SyncResult(
    val pushed: Int,
    val rejected: Int,
    val pulled: Int,
)

/**
 * Push-then-pull sync, mirroring `syncNow` in `src/lib/sync.ts`.
 *
 * - Push first: up to 200 outbox rows (oldest first) -> POST /api/v1/push;
 *   applied rows are deleted by outbox id, the rest are kept with
 *   attempts+1 and last_error "rejected by server".
 * - Pull: outbox triggers are dropped first (so downloaded rows do not
 *   echo back up), the pull cursor is read from sync_state, GET
 *   /api/v1/pull?since=cursor, each table's rows are applied inside one
 *   Room `withTransaction` per table batch (atomic per table — Room
 *   replaces the web app's transaction=false workaround; no WHERE (1)
 *   hack is needed), triggers are restored in a finally block.
 * - Cursor rule: the returned cursor is saved ONLY if every table applied
 *   without error. One bad row must not kill its table (caught per row,
 *   counted as a failure for the cursor rule); one bad table must not kill
 *   the pull (caught per table, the rest still apply).
 */
class SyncRepository(
    private val api: LubricApi,
    private val db: LubricDatabase,
    private val tokenStore: TokenStore,
) {
    private val _state = MutableStateFlow(SyncState())
    val state: StateFlow<SyncState> = _state.asStateFlow()

    /**
     * Device token, from TokenStore (null until paired). A plain Flow, not
     * a StateFlow: DataStore exposes cold flows, and wrapping one in
     * stateIn would need a scope the repository does not own. Collectors
     * get the current value on collection, as with any DataStore flow.
     */
    val deviceToken: Flow<String?> = tokenStore.deviceToken

    /** Pair this device with a one-time 8-hex code; saves the device token. */
    suspend fun pair(code: String, deviceName: String = "Lubric POS"): Result<Unit> {
        if (!PairingCodeValidator.isValid(code)) {
            return Result.failure(IllegalArgumentException("Invalid pairing code"))
        }
        return try {
            val response = api.pair(
                PairRequest(code = PairingCodeValidator.normalize(code), name = deviceName),
            )
            tokenStore.saveDeviceToken(response.token)
            Result.success(Unit)
        } catch (e: HttpException) {
            if (e.code() == 401) {
                Result.failure(Exception("Invalid or used pairing code"))
            } else {
                Result.failure(Exception(serverErrorMessage(e) ?: "Pairing failed (${e.code()})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** One sync round: push first, then pull. */
    suspend fun syncNow(): Result<SyncResult> {
        _state.value = _state.value.copy(status = SyncStatus.SYNCING, lastError = "")
        var pushed = 0
        var rejected = 0
        var pulled = 0
        try {
            // -- push ------------------------------------------------------
            val outbox = db.outboxDao().getBatch(200)
            if (outbox.isNotEmpty()) {
                val changes = outbox.map { row ->
                    PushChange(
                        table = row.tableName,
                        uuid = row.rowUuid,
                        op = row.op,
                        row = JsonParser.parseString(row.payload).asJsonObject,
                    )
                }
                val response = api.push(PushRequest(changes))
                pushed = response.applied.size
                rejected = response.rejected.size
                val appliedUuids = response.applied.mapNotNull { it.uuid }.toSet()
                for (row in outbox) {
                    if (appliedUuids.contains(row.rowUuid)) {
                        db.outboxDao().deleteById(row.id)
                    } else {
                        db.outboxDao().markRejected(row.id, "rejected by server")
                    }
                }
            }

            // -- pull ------------------------------------------------------
            // Triggers down while pulled rows land, or every downloaded row
            // queues straight back up for the next push (an echo loop).
            db.dropOutboxTriggers()
            try {
                val cursor = db.syncStateDao().getPullCursor()
                val pull = api.pull(cursor)
                var allApplied = true
                for ((table, rows) in pull.changes) {
                    if (!SyncTables.ALL.contains(table)) continue
                    try {
                        db.withTransaction {
                            for (rowJson in rows) {
                                try {
                                    PullApplier.apply(db, table, SyncNormalize.normalizeRow(rowJson))
                                    pulled++
                                } catch (e: Exception) {
                                    // One bad row must not kill the table.
                                    allApplied = false
                                }
                            }
                        }
                    } catch (e: Exception) {
                        // One bad table must not kill the pull.
                        allApplied = false
                    }
                }
                if (allApplied) {
                    db.syncStateDao().setPullCursor(pull.cursor)
                }
                // If any table failed, the old cursor is kept so the next
                // round re-fetches; upserts are idempotent.
            } finally {
                db.createOutboxTriggers()
            }

            _state.value = SyncState(
                status = SyncStatus.IDLE,
                lastSyncAt = Instant.now().toString(),
                pushed = pushed,
                pulled = pulled,
                rejected = rejected,
            )
            return Result.success(SyncResult(pushed = pushed, rejected = rejected, pulled = pulled))
        } catch (e: Exception) {
            val message = (e as? HttpException)?.let { serverErrorMessage(it) }
                ?: e.message
                ?: "Sync failed"
            _state.value = _state.value.copy(status = SyncStatus.ERROR, lastError = message)
            return Result.failure(Exception(message, e))
        }
    }

    /** Row counts for every sync table (used by the home screen). */
    suspend fun tableCounts(): Map<String, Int> {
        val counts = LinkedHashMap<String, Int>()
        for (table in SyncTables.ALL) {
            counts[table] = when (table) {
                "products" -> db.productDao().count()
                "services" -> db.serviceDao().count()
                "customers" -> db.customerDao().count()
                "vehicles" -> db.vehicleDao().count()
                "vendors" -> db.vendorDao().count()
                "categories" -> db.categoryDao().count()
                "brands" -> db.brandDao().count()
                "orders" -> db.orderDao().count()
                "order_items" -> db.orderItemDao().count()
                "expenses" -> db.expenseDao().count()
                "accounts" -> db.accountDao().count()
                "account_transactions" -> db.accountTransactionDao().count()
                "purchase_orders" -> db.purchaseOrderDao().count()
                "vendor_payables" -> db.vendorPayableDao().count()
                "reminders" -> db.reminderDao().count()
                "inspections" -> db.inspectionDao().count()
                "cash_movements" -> db.cashMovementDao().count()
                "reservations" -> db.reservationDao().count()
                "party_ledger" -> db.partyLedgerDao().count()
                "commitments" -> db.commitmentDao().count()
                "stock_movements" -> db.stockMovementDao().count()
                "price_lists" -> db.priceListDao().count()
                "price_list_items" -> db.priceListItemDao().count()
                "party_price_lists" -> db.partyPriceListDao().count()
                "party_prices" -> db.partyPriceDao().count()
                "customer_groups" -> db.customerGroupDao().count()
                "units" -> db.unitDao().count()
                "unit_conversions" -> db.unitConversionDao().count()
                "warehouses" -> db.warehouseDao().count()
                "warehouse_locations" -> db.warehouseLocationDao().count()
                else -> 0
            }
        }
        return counts
    }

    /**
     * Enqueues the unique periodic sync work (kept, never duplicated).
     *
     * DEVIATION from the web app: the web `startSyncLoop` runs every
     * 2 minutes, but WorkManager's minimum periodic interval is 15
     * minutes, so PeriodicWorkRequest cannot reproduce it. Sync-on-app-open
     * and manual Sync now cover the gap; a shorter interval would need a
     * foreground service or in-app timer in a later phase.
     */
    fun startPeriodicSync(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    private fun serverErrorMessage(e: HttpException): String? {
        return try {
            val body = e.response()?.errorBody()?.string() ?: return null
            val json = JsonParser.parseString(body).asJsonObject
            json.get("error")?.asString ?: json.get("message")?.asString
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        const val PERIODIC_WORK_NAME = "lubric-sync"
    }
}
