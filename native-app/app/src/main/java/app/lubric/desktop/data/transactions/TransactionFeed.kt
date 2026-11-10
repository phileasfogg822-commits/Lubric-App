package app.lubric.desktop.data.transactions

import app.lubric.desktop.data.db.AccountTransactionEntity
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.pricing.round2

/**
 * Pure combined-feed logic for the Transactions screen, mirroring the web
 * `SalesHistory.tsx` merge (one flat ledger, newest first). No Android or
 * Room imports beyond the entity types, so unit tests run on the JVM.
 *
 * The native feed covers orders + account_transactions only (this package's
 * scope). The web feed additionally merges purchase_orders, expenses and
 * cash_movements — those rows are NOT in this feed; see the report.
 */

/** Type filter for the combined feed: all rows, sales only, money only. */
enum class TransactionFeedType { ALL, SALES, MONEY }

/**
 * One row of the combined feed.
 *
 * - kind "sale": an order. [paid] is `paid_amount`, [status] is the order
 *   status, [label] is "Order #<id>".
 * - kind "money": an account transaction. [paid] equals [amount] (the web
 *   sets the same for non-sale rows), [status] is "in" or "out", [label]
 *   is the transaction reference.
 */
data class FeedEntry(
    val kind: String,
    val id: Long,
    val at: String,
    val amount: Double,
    val paid: Double,
    val status: String,
    val label: String,
)

/**
 * Merge orders and account transactions into one feed, newest first
 * (`created_at` descending, id descending as the tie-break — the web's
 * SQL orders by `created_at DESC, id DESC` per source).
 *
 * Draft orders are excluded, like the web (`o.status <> 'draft'`).
 * Cancelled orders stay in the feed, dimmed by the screen, like the web.
 */
fun mergeTransactionFeed(
    orders: List<OrderEntity>,
    transactions: List<AccountTransactionEntity>,
    type: TransactionFeedType,
): List<FeedEntry> {
    val out = mutableListOf<FeedEntry>()
    if (type != TransactionFeedType.MONEY) {
        for (order in orders) {
            if (order.status == "draft") continue
            out += FeedEntry(
                kind = "sale",
                id = order.id,
                at = order.createdAt ?: "",
                amount = round2(order.total ?: 0.0),
                paid = round2(order.paidAmount ?: 0.0),
                status = order.status,
                label = "Order #${order.id}",
            )
        }
    }
    if (type != TransactionFeedType.SALES) {
        for (txn in transactions) {
            val amount = round2(txn.amount ?: 0.0)
            out += FeedEntry(
                kind = "money",
                id = txn.id,
                at = txn.createdAt ?: "",
                amount = amount,
                paid = amount,
                status = txn.type,
                label = txn.reference.ifBlank { "Account movement" },
            )
        }
    }
    return out.sortedWith(
        compareByDescending<FeedEntry> { it.at }.thenByDescending { it.id },
    )
}

/** Summary totals over a merged feed. Money in/out are NOT added to the sales paid total: the "Order #N" account-transaction rows ARE the sales payments, so adding them would double-count. */
data class FeedTotals(
    val count: Int,
    val billed: Double,
    val paid: Double,
    val moneyIn: Double,
    val moneyOut: Double,
)

fun feedTotals(entries: List<FeedEntry>): FeedTotals {
    var billed = 0.0
    var paid = 0.0
    var moneyIn = 0.0
    var moneyOut = 0.0
    for (entry in entries) {
        if (entry.kind == "sale") {
            billed += entry.amount
            paid += entry.paid
        } else if (entry.status == "in") {
            moneyIn += entry.amount
        } else if (entry.status == "out") {
            moneyOut += entry.amount
        }
    }
    return FeedTotals(
        count = entries.size,
        billed = round2(billed),
        paid = round2(paid),
        moneyIn = round2(moneyIn),
        moneyOut = round2(moneyOut),
    )
}

/**
 * The status a voided order lands in. Only a completed order can be
 * voided (web `voidOrder`: "Only completed orders can be voided") — a
 * cancelled order cannot be voided again, and neither can a draft.
 */
fun voidOrderStatus(currentStatus: String): String {
    require(currentStatus == "completed") { "Only completed orders can be voided" }
    return "cancelled"
}
