package app.lubric.desktop.data.accounts

import app.lubric.desktop.data.db.AccountEntity
import app.lubric.desktop.data.db.AccountTransactionEntity
import app.lubric.desktop.data.db.LubricDatabase
import java.time.Instant
import java.util.UUID

/**
 * Account types allowed by migration 027's CHECK
 * (`('cash','bank','other')`). The web form also offers 'credit_card'
 * and the stale `001_init.sql` says 'wallet' — both are REJECTED here
 * because the migration CHECK would refuse them at the database.
 */
val ALLOWED_ACCOUNT_TYPES = setOf("cash", "bank", "other")

/** Pure account-type check, so unit tests can call it without Room. */
fun isAllowedAccountType(type: String): Boolean = type in ALLOWED_ACCOUNT_TYPES

/**
 * Account repository: list, detail (account + ledger history), and
 * add/edit, mirroring the web Accounts screen
 * (`src/modules/accounts/Accounts.tsx`).
 *
 * The web edit updates only name + type (balance/active are untouched);
 * add inserts with balance 0 and active 1. Writes go through the DAO
 * upserts, so the existing outbox triggers queue them for sync — no
 * manual `sync_outbox` writes.
 */
class AccountRepository(private val db: LubricDatabase) {

    /** All accounts, ordered by name (web: no active filter on this list). */
    suspend fun accounts(): List<AccountEntity> = db.accountQueriesDao().listAll()

    /** Active accounts only — the picker source for the expense form (web: `WHERE active = 1`). */
    suspend fun activeAccounts(): List<AccountEntity> = db.accountDao().listActive()

    data class AccountDetail(
        val account: AccountEntity,
        val transactions: List<AccountTransactionEntity>,
    )

    /** Account + its last 50 ledger rows, newest first. */
    suspend fun accountDetail(id: Long): AccountDetail {
        val account = db.accountQueriesDao().getById(id)
            ?: throw IllegalArgumentException("Account not found")
        val transactions = db.accountQueriesDao().transactionsByAccount(id.toInt())
        return AccountDetail(account, transactions)
    }

    /** Most recent ledger rows across all accounts. */
    suspend fun recentTransactions(limit: Int): List<AccountTransactionEntity> =
        db.accountQueriesDao().recentTransactions(limit)

    data class AccountForm(val name: String, val type: String)

    /**
     * Add (existingId null) or edit an account. Returns the account id.
     * Validates a non-blank name and an allowed type; sets a fresh uuid
     * on add and `updated_at` on every save.
     */
    suspend fun saveAccount(
        form: AccountForm,
        shopId: Int,
        existingId: Long? = null,
    ): Long {
        val name = form.name.trim()
        require(name.isNotBlank()) { "Account name required" }
        require(isAllowedAccountType(form.type)) {
            "Account type must be cash, bank or other"
        }
        val now = Instant.now().toString()
        if (existingId == null) {
            val uuid = UUID.randomUUID().toString()
            db.accountDao().upsert(
                AccountEntity(
                    name = name,
                    type = form.type,
                    balance = 0.0,
                    active = true,
                    uuid = uuid,
                    shopId = shopId,
                    updatedAt = now,
                ),
            )
            return db.accountDao().getByUuid(uuid)?.id
                ?: throw IllegalStateException("Account save did not persist")
        } else {
            val existing = db.accountQueriesDao().getById(existingId)
                ?: throw IllegalArgumentException("Account not found")
            db.accountDao().upsert(
                existing.copy(name = name, type = form.type, updatedAt = now),
            )
            return existingId
        }
    }

    /** Web toggle: flip the account's active flag, balance untouched. */
    suspend fun setAccountActive(id: Long, active: Boolean) {
        val existing = db.accountQueriesDao().getById(id)
            ?: throw IllegalArgumentException("Account not found")
        db.accountDao().upsert(
            existing.copy(active = active, updatedAt = Instant.now().toString()),
        )
    }
}
