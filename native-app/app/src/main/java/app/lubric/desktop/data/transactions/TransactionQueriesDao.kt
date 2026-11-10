package app.lubric.desktop.data.transactions

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.AccountTransactionEntity
import app.lubric.desktop.data.db.OrderEntity

/**
 * Read queries for the Transactions screen
 * (`src/modules/sales/SalesHistory.tsx`).
 *
 * Dates are ISO text, so the half-open range (`created_at >= :from AND
 * created_at < :to`) compares lexicographically — the caller passes the
 * day AFTER the last wanted day as `:to`. List queries cap at 500 rows,
 * like the web's `LIMIT 500`.
 *
 * NOTE: this DAO must be registered on [app.lubric.desktop.data.db.LubricDatabase]
 * as `abstract fun transactionQueriesDao(): TransactionQueriesDao`
 * (coordinator-owned wiring; this package may not edit LubricDatabase.kt).
 */
@Dao
interface TransactionQueriesDao {

    @Query("SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 500")
    suspend fun ordersRecent(): List<OrderEntity>

    @Query(
        "SELECT * FROM orders WHERE status = :status " +
            "ORDER BY created_at DESC, id DESC LIMIT 500",
    )
    suspend fun ordersByStatus(status: String): List<OrderEntity>

    @Query(
        "SELECT * FROM orders WHERE created_at >= :from AND created_at < :to " +
            "ORDER BY created_at DESC, id DESC LIMIT 500",
    )
    suspend fun ordersInRange(from: String, to: String): List<OrderEntity>

    @Query("SELECT * FROM orders WHERE id = :id LIMIT 1")
    suspend fun orderById(id: Long): OrderEntity?

    @Query(
        "SELECT * FROM account_transactions " +
            "ORDER BY created_at DESC, id DESC LIMIT :limit",
    )
    suspend fun recentAccountTransactions(limit: Int): List<AccountTransactionEntity>
}
