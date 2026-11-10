package app.lubric.desktop.data.expenses

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.ExpenseEntity

/**
 * Read queries for expenses.
 *
 * Separate from [app.lubric.desktop.data.db.ExpenseDao] (which owns the
 * upsert the sync layer uses) so the expenses screen gets the exact
 * reads the web Expenses screen issues, without touching the sync DAO.
 *
 * Ordering mirrors the web's DAY expression
 * (`COALESCE(NULLIF(e.date, ''), to_char(e.created_at, 'YYYY-MM-DD'))`):
 * the expense's own date when set, else the created day. SQLite has no
 * `to_char`, so the created day is `substr(created_at, 1, 10)`.
 * Soft-deleted rows (`deleted_at` set) are excluded everywhere, matching
 * the web list (the web hard-deletes; see [ExpenseRepository.deleteExpense]).
 *
 * NOTE (coordinator wiring): [app.lubric.desktop.data.db.LubricDatabase]
 * must expose this DAO with `abstract fun expenseQueriesDao():
 * ExpenseQueriesDao` — that file is outside this package's scope.
 */
@Dao
interface ExpenseQueriesDao {

    @Query(
        "SELECT * FROM expenses WHERE deleted_at IS NULL " +
            "ORDER BY COALESCE(NULLIF(date, ''), substr(created_at, 1, 10)) DESC, id DESC " +
            "LIMIT 500",
    )
    suspend fun listAll(): List<ExpenseEntity>

    /** Search by note or category (web list has no free-text search; the screen adds it). */
    @Query(
        "SELECT * FROM expenses WHERE deleted_at IS NULL AND " +
            "(note LIKE '%' || :q || '%' OR category LIKE '%' || :q || '%') " +
            "ORDER BY COALESCE(NULLIF(date, ''), substr(created_at, 1, 10)) DESC, id DESC " +
            "LIMIT 500",
    )
    suspend fun search(q: String): List<ExpenseEntity>

    @Query(
        "SELECT * FROM expenses WHERE deleted_at IS NULL AND category = :category " +
            "ORDER BY COALESCE(NULLIF(date, ''), substr(created_at, 1, 10)) DESC, id DESC " +
            "LIMIT 500",
    )
    suspend fun byCategory(category: String): List<ExpenseEntity>

    @Query("SELECT * FROM expenses WHERE id = :id LIMIT 1")
    suspend fun getById(id: Long): ExpenseEntity?

    /** Distinct categories actually used (merged with the fixed taxonomy in the UI). */
    @Query(
        "SELECT DISTINCT category FROM expenses " +
            "WHERE deleted_at IS NULL AND category != '' ORDER BY category",
    )
    suspend fun categories(): List<String>
}
