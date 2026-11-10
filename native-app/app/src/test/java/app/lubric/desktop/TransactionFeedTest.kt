package app.lubric.desktop

import app.lubric.desktop.data.db.AccountTransactionEntity
import app.lubric.desktop.data.db.CashMovementEntity
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.field.fieldTotals
import app.lubric.desktop.data.reminders.relativeDue
import app.lubric.desktop.data.reminders.reminderBucket
import app.lubric.desktop.data.reminders.reminderStatusAfter
import app.lubric.desktop.data.transactions.TransactionFeedType
import app.lubric.desktop.data.transactions.feedTotals
import app.lubric.desktop.data.transactions.mergeTransactionFeed
import app.lubric.desktop.data.transactions.voidOrderStatus
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Pure-JVM tests for Package D (Reminders + Transactions + Field Activity).
 * No Room or Android classes are exercised — only the pure merge/sort,
 * totals, and state-machine functions.
 */
class TransactionFeedTest {

    private fun order(
        id: Long,
        status: String = "completed",
        total: Double = 1000.0,
        paid: Double = 1000.0,
        createdAt: String? = "2026-11-10T10:00:00",
    ) = OrderEntity(
        id = id,
        status = status,
        total = total,
        paidAmount = paid,
        createdAt = createdAt,
    )

    private fun money(
        id: Long,
        amount: Double = 1000.0,
        type: String = "in",
        reference: String = "Order #1",
        createdAt: String? = "2026-11-10T10:00:00",
    ) = AccountTransactionEntity(
        id = id,
        amount = amount,
        type = type,
        reference = reference,
        createdAt = createdAt,
    )

    // -- feed merge + sort -------------------------------------------------

    @Test
    fun `feed merges orders and money newest first`() {
        val entries = mergeTransactionFeed(
            orders = listOf(
                order(id = 1, createdAt = "2026-11-09T10:00:00"),
                order(id = 2, createdAt = "2026-11-11T10:00:00"),
            ),
            transactions = listOf(money(id = 5, createdAt = "2026-11-10T10:00:00")),
            type = TransactionFeedType.ALL,
        )
        assertEquals(listOf(2L, 5L, 1L), entries.map { it.id })
        assertEquals(listOf("sale", "money", "sale"), entries.map { it.kind })
    }

    @Test
    fun `feed sales filter excludes money and draft orders`() {
        val entries = mergeTransactionFeed(
            orders = listOf(
                order(id = 1),
                order(id = 2, status = "draft"),
                order(id = 3, status = "cancelled"),
            ),
            transactions = listOf(money(id = 5)),
            type = TransactionFeedType.SALES,
        )
        // Draft excluded; cancelled kept (the web keeps it, dimmed).
        assertEquals(listOf(3L, 1L), entries.map { it.id })
    }

    @Test
    fun `feed money filter excludes sales`() {
        val entries = mergeTransactionFeed(
            orders = listOf(order(id = 1)),
            transactions = listOf(
                money(id = 5, type = "in"),
                money(id = 6, type = "out", reference = "Expense"),
            ),
            type = TransactionFeedType.MONEY,
        )
        assertEquals(listOf(6L, 5L), entries.map { it.id })
        assertEquals(listOf("out", "in"), entries.map { it.status })
    }

    @Test
    fun `feed sorts equal timestamps by id descending`() {
        val entries = mergeTransactionFeed(
            orders = listOf(
                order(id = 3, createdAt = "2026-11-10T10:00:00"),
                order(id = 7, createdAt = "2026-11-10T10:00:00"),
            ),
            transactions = emptyList(),
            type = TransactionFeedType.ALL,
        )
        assertEquals(listOf(7L, 3L), entries.map { it.id })
    }

    @Test
    fun `feed totals do not double count sale payments`() {
        val entries = mergeTransactionFeed(
            orders = listOf(order(id = 1, total = 5000.0, paid = 3000.0)),
            transactions = listOf(
                // The "Order #1" money row IS the sale's payment, so it
                // must not be added to the sales paid total.
                money(id = 9, amount = 5000.0, type = "in", reference = "Order #1"),
                money(id = 10, amount = 200.0, type = "out", reference = "Expense"),
            ),
            type = TransactionFeedType.ALL,
        )
        val totals = feedTotals(entries)
        assertEquals(5000.0, totals.billed, 0.0)
        assertEquals(3000.0, totals.paid, 0.0)
        assertEquals(5000.0, totals.moneyIn, 0.0)
        assertEquals(200.0, totals.moneyOut, 0.0)
    }

    // -- void state rules --------------------------------------------------

    @Test
    fun `void allows only completed orders`() {
        assertEquals("cancelled", voidOrderStatus("completed"))
        assertThrows(IllegalArgumentException::class.java) { voidOrderStatus("cancelled") }
        assertThrows(IllegalArgumentException::class.java) { voidOrderStatus("draft") }
        assertThrows(IllegalArgumentException::class.java) { voidOrderStatus("returned") }
    }

    // -- reminder status transitions ---------------------------------------

    @Test
    fun `reminder done and dismissed transitions from pending`() {
        assertEquals("done", reminderStatusAfter("pending", "done"))
        assertEquals("dismissed", reminderStatusAfter("pending", "dismissed"))
    }

    @Test
    fun `reminder reopen returns to pending`() {
        assertEquals("pending", reminderStatusAfter("done", "reopen"))
        assertEquals("pending", reminderStatusAfter("dismissed", "reopen"))
    }

    @Test
    fun `reminder transitions reject invalid states`() {
        assertThrows(IllegalArgumentException::class.java) {
            reminderStatusAfter("done", "done")
        }
        assertThrows(IllegalArgumentException::class.java) {
            reminderStatusAfter("pending", "reopen")
        }
        assertThrows(IllegalArgumentException::class.java) {
            reminderStatusAfter("pending", "snooze")
        }
    }

    // -- reminder buckets and due labels -----------------------------------

    private val noonNov11: Long =
        LocalDateTime.of(2026, 11, 11, 12, 0).atZone(ZoneId.systemDefault())
            .toInstant().toEpochMilli()

    @Test
    fun `reminder bucket classifies overdue today upcoming and undated`() {
        assertEquals("overdue", reminderBucket("2026-11-10T09:00:00", noonNov11))
        assertEquals("today", reminderBucket("2026-11-11T15:00:00", noonNov11))
        assertEquals("upcoming", reminderBucket("2026-11-20", noonNov11))
        assertEquals("upcoming", reminderBucket(null, noonNov11))
        assertEquals("upcoming", reminderBucket("not-a-date", noonNov11))
    }

    @Test
    fun `relativeDue labels today tomorrow and overdue`() {
        assertEquals("today 15:00", relativeDue("2026-11-11T15:00:00", noonNov11))
        assertEquals("tomorrow 09:30", relativeDue("2026-11-12T09:30:00", noonNov11))
        assertEquals("in 2 day(s)", relativeDue("2026-11-13T12:00:00", noonNov11))
        assertEquals("3 day(s) overdue", relativeDue("2026-11-08T12:00:00", noonNov11))
        assertEquals("No date", relativeDue(null, noonNov11))
    }

    // -- field totals ------------------------------------------------------

    @Test
    fun `field totals sum collected handed over and in hand`() {
        val totals = fieldTotals(
            listOf(
                CashMovementEntity(kind = "collection", amount = 1000.0),
                CashMovementEntity(kind = "collection", amount = 500.0),
                CashMovementEntity(kind = "handover", amount = 400.0),
                CashMovementEntity(kind = "adjustment", amount = 50.0),
                // An expense movement counts in none of the buckets.
                CashMovementEntity(kind = "expense", amount = 999.0),
            ),
        )
        assertEquals(1500.0, totals.collected, 0.0)
        assertEquals(400.0, totals.handedOver, 0.0)
        assertEquals(50.0, totals.adjusted, 0.0)
        assertEquals(5, totals.rows)
        assertEquals(1100.0, totals.inHand, 0.0)
    }
}
