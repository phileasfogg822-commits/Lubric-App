package app.lubric.desktop

import app.lubric.desktop.data.accounts.isAllowedAccountType
import app.lubric.desktop.data.db.ExpenseEntity
import app.lubric.desktop.data.expenses.applyExpense
import app.lubric.desktop.data.expenses.editExpenseBalances
import app.lubric.desktop.data.expenses.expenseDay
import app.lubric.desktop.data.expenses.expenseLabel
import app.lubric.desktop.data.expenses.reverseExpense
import app.lubric.desktop.data.expenses.validateExpense
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM tests for the expense → account linkage math and the
 * account/expense validation rules. No Room or Android classes are
 * exercised here — only the pure helpers in
 * `data.accounts` / `data.expenses`, mirroring the web Expenses screen
 * (`src/modules/expenses/Expenses.tsx`) and migration 027.
 */
class ExpenseAccountLinkTest {

    // -- account-type validation (migration 027 CHECK) --------------------

    @Test
    fun `wallet is rejected and credit card is rejected, cash bank other accepted`() {
        assertFalse(isAllowedAccountType("wallet"))
        assertFalse(isAllowedAccountType("credit_card"))
        assertFalse(isAllowedAccountType(""))
        assertTrue(isAllowedAccountType("cash"))
        assertTrue(isAllowedAccountType("bank"))
        assertTrue(isAllowedAccountType("other"))
    }

    // -- new expense linkage ----------------------------------------------

    @Test
    fun `new expense debits the account and labels the out transaction`() {
        assertEquals(3800.0, applyExpense(5000.0, 1200.0), 0.0)
        assertEquals(0.0, applyExpense(1200.0, 1200.0), 0.0)
        assertEquals("Expense: Shop / Rent", expenseLabel("Shop", "Rent"))
        assertEquals("Expense: Food", expenseLabel("Food", ""))
    }

    @Test
    fun `expense balances stay paisa-exact`() {
        assertEquals(66.67, applyExpense(100.0, 33.33), 0.0)
        assertEquals(9.9, applyExpense(10.0, 0.1), 0.0)
    }

    // -- edit reversal ------------------------------------------------------

    @Test
    fun `edit on the same account nets the old amount back and the new amount out`() {
        val result = editExpenseBalances(
            oldAccountId = 1, oldAmount = 500.0,
            newAccountId = 1, newAmount = 800.0,
            balances = mapOf(1L to 10000.0),
        )
        assertEquals(mapOf(1L to 9700.0), result)
    }

    @Test
    fun `edit moving accounts credits the old account and debits the new one`() {
        val result = editExpenseBalances(
            oldAccountId = 1, oldAmount = 500.0,
            newAccountId = 2, newAmount = 800.0,
            balances = mapOf(1L to 10000.0, 2L to 2000.0),
        )
        assertEquals(mapOf(1L to 10500.0, 2L to 1200.0), result)
    }

    @Test
    fun `edit with an unchanged amount leaves the balance untouched`() {
        val result = editExpenseBalances(
            oldAccountId = 1, oldAmount = 500.0,
            newAccountId = 1, newAmount = 500.0,
            balances = mapOf(1L to 10000.0),
        )
        assertEquals(mapOf(1L to 10000.0), result)
    }

    // -- delete reversal ----------------------------------------------------

    @Test
    fun `delete reversal credits the amount back to the account`() {
        assertEquals(5000.0, reverseExpense(3800.0, 1200.0), 0.0)
        assertEquals(0.0, reverseExpense(-500.0, 500.0), 0.0)
    }

    // -- expense validation -------------------------------------------------

    @Test
    fun `expense validation rejects zero and negative amounts and a missing account`() {
        assertThrows(IllegalArgumentException::class.java) { validateExpense(0.0, 1L) }
        assertThrows(IllegalArgumentException::class.java) { validateExpense(-50.0, 1L) }
        assertThrows(IllegalArgumentException::class.java) { validateExpense(100.0, null) }
        // A positive amount with an account passes.
        validateExpense(100.0, 1L)
    }

    // -- expense day (web DAY fallback) --------------------------------------

    @Test
    fun `expenseDay prefers the expense date and falls back to the created day`() {
        assertEquals(
            "2026-11-05",
            expenseDay(ExpenseEntity(date = "2026-11-05", createdAt = "2026-11-10T08:00:00")),
        )
        assertEquals(
            "2026-11-10",
            expenseDay(ExpenseEntity(date = "", createdAt = "2026-11-10T08:00:00")),
        )
        assertEquals(
            "2026-11-10",
            expenseDay(ExpenseEntity(date = null, createdAt = "2026-11-10T08:00:00")),
        )
        assertEquals("", expenseDay(ExpenseEntity(date = null, createdAt = null)))
    }
}
