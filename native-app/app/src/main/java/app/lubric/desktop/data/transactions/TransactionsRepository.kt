package app.lubric.desktop.data.transactions

import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.db.OrderItemEntity
import java.time.Instant

/**
 * Transactions repository: the combined orders + account_transactions feed,
 * order detail, and void.
 *
 * Mirrors the web SalesHistory page (`src/modules/sales/SalesHistory.tsx`)
 * for the rows this package owns. Writes go through the existing DAOs'
 * upserts, so the outbox triggers queue them for sync — never write
 * `sync_outbox` rows directly.
 *
 * VOID SCOPE — read this before calling [voidOrder]: the web `voidOrder`
 * (`src/modules/sales/editSale.ts`) is a compensating transaction — it
 * returns product stock, folds shelved leftover back into its container,
 * reverses the used-oil drum, reverses the posted ledger movement, AND
 * then sets status='cancelled'. This phase implements ONLY the last step
 * (status flip, row kept for the audit trail). Stock, containers, used
 * oil and the account ledger are NOT reversed here; the full reversal
 * belongs with the edit-sale work and must land before void is offered
 * as a complete operation. The screen's confirm text does not claim a
 * reversal happens.
 *
 * NOT in this phase: edit-sale (`saveOrderEdits`), delete of a voided
 * order (`deleteVoidedOrder`), purchases/expenses/field rows in the feed.
 */
class TransactionsRepository(private val db: LubricDatabase) {

    /**
     * The combined feed, newest first.
     *
     * [from]/[to] are ISO dates forming a half-open range
     * (`created_at >= from AND created_at < to`); pass the day AFTER the
     * last wanted day as [to]. When either bound is missing, the recent
     * lists are fetched and the present bound is applied in memory.
     */
    suspend fun feed(
        type: TransactionFeedType = TransactionFeedType.ALL,
        from: String? = null,
        to: String? = null,
    ): List<FeedEntry> {
        val dao = db.transactionQueriesDao()
        val hasRange = !from.isNullOrBlank() && !to.isNullOrBlank()
        val orders = if (hasRange) dao.ordersInRange(from!!, to!!) else dao.ordersRecent()
        val transactions = dao.recentAccountTransactions(500)
        val rangedOrders = if (hasRange) {
            orders
        } else {
            orders.filter { order ->
                (from.isNullOrBlank() || (order.createdAt ?: "") >= from) &&
                    (to.isNullOrBlank() || (order.createdAt ?: "") < to)
            }
        }
        val rangedTransactions = transactions.filter { txn ->
            (from.isNullOrBlank() || (txn.createdAt ?: "") >= from) &&
                (to.isNullOrBlank() || (txn.createdAt ?: "") < to)
        }
        return mergeTransactionFeed(rangedOrders, rangedTransactions, type)
    }

    /** An order plus its lines, for the detail screen. */
    data class OrderDetail(val order: OrderEntity, val items: List<OrderItemEntity>)

    suspend fun orderDetail(id: Long): OrderDetail {
        val order = db.transactionQueriesDao().orderById(id)
            ?: throw IllegalArgumentException("Order not found")
        return OrderDetail(order, db.orderItemDao().byOrder(id.toInt()))
    }

    /**
     * Void a completed order: status -> 'cancelled', row kept for the
     * audit trail (never hard-deleted). A cancelled order cannot be
     * voided again — throws. See the class KDoc for what this does NOT
     * reverse yet.
     */
    suspend fun voidOrder(id: Long) {
        val order = db.transactionQueriesDao().orderById(id)
            ?: throw IllegalArgumentException("Order not found")
        val next = voidOrderStatus(order.status)
        db.orderDao().upsert(
            order.copy(status = next, updatedAt = Instant.now().toString()),
        )
    }
}
