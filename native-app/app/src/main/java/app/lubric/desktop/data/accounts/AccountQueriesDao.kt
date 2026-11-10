package app.lubric.desktop.data.accounts

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.AccountEntity
import app.lubric.desktop.data.db.AccountTransactionEntity

/**
 * Read queries for accounts and their ledger rows.
 *
 * Separate from [app.lubric.desktop.data.db.AccountDao] /
 * [app.lubric.desktop.data.db.AccountTransactionDao] (which own the
 * upserts the sync layer uses) so the account screens get the exact
 * reads the web Accounts screen issues, without touching the sync DAOs.
 *
 * NOTE (coordinator wiring): [app.lubric.desktop.data.db.LubricDatabase]
 * must expose this DAO with `abstract fun accountQueriesDao():
 * AccountQueriesDao` — that file is outside this package's scope.
 */
@Dao
interface AccountQueriesDao {

    /** Web: `SELECT * FROM accounts ORDER BY name` (all accounts, active or not). */
    @Query("SELECT * FROM accounts ORDER BY name")
    suspend fun listAll(): List<AccountEntity>

    @Query("SELECT * FROM accounts WHERE id = :id LIMIT 1")
    suspend fun getById(id: Long): AccountEntity?

    /**
     * Web: `SELECT * FROM account_transactions WHERE account_id=$1
     * ORDER BY created_at DESC LIMIT 50` (the History modal).
     */
    @Query(
        "SELECT * FROM account_transactions WHERE account_id = :accountId " +
            "ORDER BY created_at DESC LIMIT 50",
    )
    suspend fun transactionsByAccount(accountId: Int): List<AccountTransactionEntity>

    /** Most recent ledger rows across all accounts (dashboard/feed use). */
    @Query("SELECT * FROM account_transactions ORDER BY created_at DESC LIMIT :limit")
    suspend fun recentTransactions(limit: Int): List<AccountTransactionEntity>
}
