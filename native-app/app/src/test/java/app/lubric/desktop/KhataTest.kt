package app.lubric.desktop

import app.lubric.desktop.data.ledger.LedgerEntry
import app.lubric.desktop.data.ledger.OpenPayable
import app.lubric.desktop.data.ledger.allocatePayables
import app.lubric.desktop.data.ledger.monthKey
import app.lubric.desktop.data.ledger.partyBalanceFromEntries
import app.lubric.desktop.data.ledger.validateBillAmount
import app.lubric.desktop.data.ledger.validatePaymentAmount
import app.lubric.desktop.data.ledger.withRunningBalances
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class KhataTest {

    private fun entry(
        id: Long = 1,
        direction: String = "debit",
        amount: Double = 100.0,
        occurredAt: String? = "2026-11-01",
    ) = LedgerEntry(
        id = id,
        uuid = "uuid-$id",
        kind = "bill",
        direction = direction,
        amount = amount,
        note = "",
        occurredAt = occurredAt,
        orderId = null,
        vendorPayableId = null,
    )

    // -- Running balance ----------------------------------------------------

    @Test
    fun `running balance accumulates debits from the opening balance`() {
        val rows = withRunningBalances(
            opening = 500.0,
            entries = listOf(entry(1, "debit", 100.0), entry(2, "debit", 50.0)),
        )
        assertEquals(600.0, rows[0].running, 0.0)
        assertEquals(650.0, rows[1].running, 0.0)
    }

    @Test
    fun `running balance subtracts credits`() {
        val rows = withRunningBalances(
            opening = 650.0,
            entries = listOf(entry(1, "credit", 200.0), entry(2, "debit", 25.5)),
        )
        assertEquals(450.0, rows[0].running, 0.0)
        assertEquals(475.5, rows[1].running, 0.0)
    }

    @Test
    fun `running balance ends at opening plus net movement`() {
        val entries = listOf(
            entry(1, "debit", 1000.0),
            entry(2, "credit", 400.0),
            entry(3, "debit", 60.0),
        )
        val rows = withRunningBalances(opening = 100.0, entries = entries)
        assertEquals(760.0, rows.last().running, 0.0)
        assertEquals(760.0, 100.0 + partyBalanceFromEntries(entries), 0.0)
    }

    // -- Party balance from entries ------------------------------------------

    @Test
    fun `party balance is debits minus credits`() {
        val balance = partyBalanceFromEntries(
            listOf(
                entry(1, "debit", 1000.0),
                entry(2, "credit", 400.0),
                entry(3, "credit", 150.25),
            ),
        )
        assertEquals(449.75, balance, 0.0)
    }

    @Test
    fun `party balance is zero with no entries`() {
        assertEquals(0.0, partyBalanceFromEntries(emptyList()), 0.0)
    }

    // -- FIFO payable allocation ----------------------------------------------

    @Test
    fun `FIFO allocation settles the oldest payable first`() {
        val settled = allocatePayables(
            payables = listOf(
                OpenPayable(id = 1, amount = 100.0, settled = 0.0),
                OpenPayable(id = 2, amount = 200.0, settled = 0.0),
            ),
            amount = 250.0,
        )
        assertEquals(2, settled.size)
        assertEquals(1L, settled[0].id)
        assertEquals(100.0, settled[0].amount, 0.0)
        assertEquals("paid", settled[0].status)
        assertEquals(2L, settled[1].id)
        assertEquals(150.0, settled[1].amount, 0.0)
        assertEquals("partial", settled[1].status)
    }

    @Test
    fun `FIFO allocation leaves the leftover unallocated`() {
        val settled = allocatePayables(
            payables = listOf(OpenPayable(id = 1, amount = 100.0, settled = 0.0)),
            amount = 500.0,
        )
        assertEquals(1, settled.size)
        assertEquals(100.0, settled[0].amount, 0.0)
        assertEquals("paid", settled[0].status)
    }

    @Test
    fun `FIFO allocation honours what is already settled and skips paid rows`() {
        val settled = allocatePayables(
            payables = listOf(
                OpenPayable(id = 1, amount = 100.0, settled = 100.0),
                OpenPayable(id = 2, amount = 200.0, settled = 50.0),
            ),
            amount = 150.0,
        )
        assertEquals(1, settled.size)
        assertEquals(2L, settled[0].id)
        assertEquals(150.0, settled[0].amount, 0.0)
        assertEquals("paid", settled[0].status)
    }

    // -- Validation -----------------------------------------------------------

    @Test
    fun `payment amount must be greater than zero`() {
        assertThrows(IllegalArgumentException::class.java) { validatePaymentAmount(0.0) }
        assertThrows(IllegalArgumentException::class.java) { validatePaymentAmount(-50.0) }
        assertEquals(100.0, validatePaymentAmount(100.0), 0.0)
    }

    @Test
    fun `bill amount must be greater than zero and is rounded to paisa`() {
        assertThrows(IllegalArgumentException::class.java) { validateBillAmount(0.0) }
        assertThrows(IllegalArgumentException::class.java) { validateBillAmount(-1.0) }
        assertEquals(100.13, validateBillAmount(100.125), 0.0)
    }

    // -- Month bucket ---------------------------------------------------------

    @Test
    fun `monthKey takes the first seven characters of the ISO date`() {
        assertEquals("2026-11", monthKey("2026-11-05"))
        assertEquals("", monthKey(null))
    }
}
