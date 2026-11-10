package app.lubric.desktop.data.expenses

import androidx.room.withTransaction
import app.lubric.desktop.data.db.AccountEntity
import app.lubric.desktop.data.db.AccountTransactionEntity
import app.lubric.desktop.data.db.ExpenseEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.pricing.round2
import java.time.Instant
import java.util.UUID

// ---------------------------------------------------------------------------
// Pure helpers (no Room/Android) — unit-tested in ExpenseAccountLinkTest.
// ---------------------------------------------------------------------------

/** Web label: "Expense: Shop / Rent" — keeps the account ledger readable. */
fun expenseLabel(category: String, subcategory: String): String =
    "Expense: $category" + if (subcategory.isNotBlank()) " / $subcategory" else ""

/** Web save validation, verbatim messages. */
fun validateExpense(amount: Double, accountId: Long?) {
    require(amount > 0) { "Enter an amount greater than zero" }
    require(accountId != null) { "Choose the account the money left from" }
}

/**
 * New balance after posting a fresh expense (money leaves the account).
 * The web updates balances in SQL NUMERIC (exact); Room stores Double,
 * so the result is rounded once with [round2] to stop float drift.
 */
fun applyExpense(balance: Double, amount: Double): Double = round2(balance - amount)

/** New balance after reversing an expense (money returns to the account). */
fun reverseExpense(balance: Double, amount: Double): Double = round2(balance + amount)

/**
 * Resulting balances after an expense EDIT, keyed by account id — the
 * web's edit reverses the original posting first, then records the
 * corrected one, even when the account changed. Same-account edits net
 * to one entry (`balance + old - new`); a moved expense credits the old
 * account and debits the new one. Accounts absent from [balances] start
 * at 0.0. Each resulting balance is rounded once with [round2].
 */
fun editExpenseBalances(
    oldAccountId: Long,
    oldAmount: Double,
    newAccountId: Long,
    newAmount: Double,
    balances: Map<Long, Double>,
): Map<Long, Double> {
    val out = balances.toMutableMap()
    if (oldAccountId == newAccountId) {
        out[newAccountId] = round2((balances[newAccountId] ?: 0.0) + oldAmount - newAmount)
    } else {
        out[oldAccountId] = round2((balances[oldAccountId] ?: 0.0) + oldAmount)
        out[newAccountId] = round2((balances[newAccountId] ?: 0.0) - newAmount)
    }
    return out
}

/**
 * The web's DAY for an expense: its own date when set, else the created
 * day (`to_char(created_at, 'YYYY-MM-DD')` — `substr` here, ISO text).
 * Used for the from/to date filters; lexicographic compare works on ISO.
 */
fun expenseDay(expense: ExpenseEntity): String {
    val date = expense.date // local copy: cross-module properties cannot be smart-cast
    return if (!date.isNullOrBlank()) date
    else expense.createdAt?.take(10) ?: ""
}

/**
 * Expense repository: list/search, distinct categories, and save/delete
 * with the linked account movement, mirroring the web Expenses screen
 * (`src/modules/expenses/Expenses.tsx`).
 *
 * Every save/delete is ONE Room transaction (expense row + account
 * balance + account_transactions row(s)), matching the web's single
 * `dbTransaction`. Writes go through the DAO upserts, so the existing
 * outbox triggers queue them for sync — no manual `sync_outbox` writes.
 */
class ExpenseRepository(private val db: LubricDatabase) {

    /**
     * Expenses ordered by day desc, optionally filtered by free-text
     * [query] (note/category), exact [category], and/or an inclusive
     * [fromDate]/[toDate] day range (ISO `YYYY-MM-DD`).
     */
    suspend fun expenses(
        query: String = "",
        category: String = "",
        fromDate: String = "",
        toDate: String = "",
    ): List<ExpenseEntity> {
        val base = if (query.isBlank()) db.expenseQueriesDao().listAll()
        else db.expenseQueriesDao().search(query.trim())
        return base.filter { e ->
            (category.isBlank() || e.category == category) &&
                (fromDate.isBlank() || expenseDay(e) >= fromDate) &&
                (toDate.isBlank() || expenseDay(e) <= toDate)
        }
    }

    /** Distinct categories actually used (the UI merges these with the fixed taxonomy). */
    suspend fun expenseCategories(): List<String> = db.expenseQueriesDao().categories()

    /** Active accounts for the "Paid from" picker (web: `WHERE active = 1 ORDER BY name`). */
    suspend fun accounts(): List<AccountEntity> = db.accountDao().listActive()

    suspend fun expenseById(id: Long): ExpenseEntity? = db.expenseQueriesDao().getById(id)

    data class ExpenseForm(
        val category: String,
        val subcategory: String,
        val amount: Double,
        val accountId: Long,
        val date: String,
        val note: String,
    )

    /**
     * Add (existingId null) or edit an expense. Returns the expense id.
     *
     * Add (web): insert expense + `balance -= amount` + one 'out'
     * account_transactions row ("Expense: <category> / <subcategory>").
     *
     * Edit (web, verbatim): reverse the original posting first —
     * `balance += oldAmount` on the OLD account + an 'in' row
     * ("Expense edit reversal: <old category>") — then record the
     * corrected one — `balance -= amount` on the (possibly new) account
     * + an 'out' row with the new label — then update the expense row.
     * The reversal rows are written even when the account/amount did
     * not change, exactly as the web does.
     */
    suspend fun saveExpense(
        form: ExpenseForm,
        shopId: Int,
        existingId: Long? = null,
    ): Long {
        validateExpense(form.amount, form.accountId)
        val now = Instant.now().toString()
        val amount = form.amount
        if (existingId == null) {
            val uuid = UUID.randomUUID().toString()
            db.withTransaction {
                db.expenseDao().upsert(
                    ExpenseEntity(
                        shopId = shopId,
                        category = form.category,
                        subcategory = form.subcategory,
                        amount = amount,
                        accountId = form.accountId.toInt(),
                        date = form.date,
                        note = form.note,
                        uuid = uuid,
                        updatedAt = now,
                    ),
                )
                applyBalanceDelta(form.accountId, -amount)
                db.accountTransactionDao().upsert(
                    AccountTransactionEntity(
                        accountId = form.accountId.toInt(),
                        amount = amount,
                        type = "out",
                        reference = expenseLabel(form.category, form.subcategory),
                        uuid = UUID.randomUUID().toString(),
                        shopId = shopId,
                        updatedAt = now,
                    ),
                )
            }
            return db.expenseDao().getByUuid(uuid)?.id
                ?: throw IllegalStateException("Expense save did not persist")
        } else {
            val before = db.expenseQueriesDao().getById(existingId)
                ?: throw IllegalArgumentException("Expense not found")
            val oldAmount = before.amount ?: 0.0
            val oldAccountId = before.accountId?.toLong() ?: form.accountId
            db.withTransaction {
                // Reverse the original posting first.
                applyBalanceDelta(oldAccountId, oldAmount)
                db.accountTransactionDao().upsert(
                    AccountTransactionEntity(
                        accountId = oldAccountId.toInt(),
                        amount = oldAmount,
                        type = "in",
                        reference = "Expense edit reversal: ${before.category}",
                        uuid = UUID.randomUUID().toString(),
                        shopId = shopId,
                        updatedAt = now,
                    ),
                )
                // Then record the corrected one.
                applyBalanceDelta(form.accountId, -amount)
                db.accountTransactionDao().upsert(
                    AccountTransactionEntity(
                        accountId = form.accountId.toInt(),
                        amount = amount,
                        type = "out",
                        reference = expenseLabel(form.category, form.subcategory),
                        uuid = UUID.randomUUID().toString(),
                        shopId = shopId,
                        updatedAt = now,
                    ),
                )
                db.expenseDao().upsert(
                    before.copy(
                        category = form.category,
                        subcategory = form.subcategory,
                        amount = amount,
                        accountId = form.accountId.toInt(),
                        date = form.date,
                        note = form.note,
                        updatedAt = now,
                    ),
                )
            }
            return existingId
        }
    }

    /**
     * Delete an expense.
     *
     * DIVERGENCE FROM WEB (deliberate, per task spec): the web HARD-deletes
     * (`DELETE FROM expenses WHERE id=$1`) after crediting the account
     * back. The native app SOFT-deletes instead — sets `deleted_at` — so
     * the deletion replicates through sync as a soft delete (expenses is
     * a soft-delete sync table) and the row stays auditable. The money
     * reversal is the web's, verbatim: `balance += amount` on the
     * expense's account + an 'in' row ("Expense deleted: <category> /
     * <subcategory>"), all in one transaction with the soft delete.
     */
    suspend fun deleteExpense(id: Long) {
        val expense = db.expenseQueriesDao().getById(id)
            ?: throw IllegalArgumentException("Expense not found")
        require(expense.deletedAt.isNullOrBlank()) { "Expense is already deleted" }
        val amount = expense.amount ?: 0.0
        val accountId = expense.accountId?.toLong()
        val now = Instant.now().toString()
        val label = "Expense deleted: ${expense.category}" +
            if (expense.subcategory.isNotBlank()) " / ${expense.subcategory}" else ""
        db.withTransaction {
            if (accountId != null) {
                applyBalanceDelta(accountId, amount)
                db.accountTransactionDao().upsert(
                    AccountTransactionEntity(
                        accountId = accountId.toInt(),
                        amount = amount,
                        type = "in",
                        reference = label,
                        uuid = UUID.randomUUID().toString(),
                        shopId = expense.shopId ?: 1,
                        updatedAt = now,
                    ),
                )
            }
            db.expenseDao().upsert(
                expense.copy(deletedAt = now, updatedAt = now),
            )
        }
    }

    /**
     * Apply a signed balance delta to one account, rounded once. A
     * missing account row is skipped for the balance (the web SQL UPDATE
     * would silently affect 0 rows) — the transaction row is still
     * written by the caller.
     */
    private suspend fun applyBalanceDelta(accountId: Long, delta: Double) {
        val account = db.accountDao().getById(accountId) ?: return
        db.accountDao().upsert(
            account.copy(balance = round2((account.balance ?: 0.0) + delta)),
        )
    }
}
