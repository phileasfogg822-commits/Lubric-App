package app.lubric.desktop.ui.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.pricing.round2
import app.lubric.desktop.data.transactions.FeedEntry
import app.lubric.desktop.data.transactions.TransactionFeedType
import app.lubric.desktop.data.transactions.TransactionsRepository
import app.lubric.desktop.data.transactions.feedTotals
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import app.lubric.desktop.ui.sale.formatMoney
import java.time.LocalDate
import kotlinx.coroutines.launch

/** Route string for the Transactions list; the coordinator wires it into Nav.kt. */
const val TRANSACTIONS_ROUTE = "transactions"

/** Route string for the order detail; {orderId} is the order's local id. */
const val TRANSACTION_DETAIL_ROUTE = "transaction_detail/{orderId}"

fun transactionDetailRoute(orderId: Long): String = "transaction_detail/$orderId"

/** "2026-09-21 14:07" from an ISO timestamp (web SalesHistory `stamp`). */
private fun stamp(value: String?): String =
    (value ?: "").replace("T", " ").split(".")[0].take(16)

class TransactionsViewModel(
    private val transactionsRepository: TransactionsRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var feedType by mutableStateOf(TransactionFeedType.ALL)
        private set
    var from by mutableStateOf("")
    var to by mutableStateOf("")
    var entries by mutableStateOf<List<FeedEntry>>(emptyList())
        private set

    init {
        refresh()
    }

    /**
     * The screen's "To" date is inclusive (the web: `date(created_at) <=
     * date(to)`); the DAO range is half-open, so the day after the entered
     * date is passed as the exclusive end.
     */
    private fun toExclusive(): String? {
        val raw = to.trim()
        if (raw.isBlank()) return null
        return try {
            LocalDate.parse(raw).plusDays(1).toString()
        } catch (_: Exception) {
            raw
        }
    }

    fun refresh() {
        viewModelScope.launch {
            entries = try {
                transactionsRepository.feed(
                    type = feedType,
                    from = from.ifBlank { null },
                    to = toExclusive(),
                )
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    fun setType(type: TransactionFeedType) {
        feedType = type
        refresh()
    }

    fun updateFrom(value: String) {
        from = value
        refresh()
    }

    fun updateTo(value: String) {
        to = value
        refresh()
    }
}

@Composable
fun TransactionsScreen(
    viewModel: TransactionsViewModel,
    onOpenOrder: (Long) -> Unit,
    onBack: () -> Unit,
) {
    val totals = feedTotals(viewModel.entries)
    LubricScreen(title = "Transactions", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for ((type, label) in listOf(
                TransactionFeedType.ALL to "All",
                TransactionFeedType.SALES to "Sales",
                TransactionFeedType.MONEY to "Money",
            )) {
                TextButton(onClick = { viewModel.setType(type) }) {
                    Text(
                        label,
                        color = if (viewModel.feedType == type) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TextField(
                value = viewModel.from,
                onValueChange = { viewModel.updateFrom(it) },
                label = { Text("From (YYYY-MM-DD)") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            TextField(
                value = viewModel.to,
                onValueChange = { viewModel.updateTo(it) },
                label = { Text("To (YYYY-MM-DD)") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
        }
        Spacer(Modifier.height(12.dp))
        Text("Transactions: ${totals.count}")
        Text("Billed (sales): ${formatMoney(totals.billed)}")
        Text("Paid (sales): ${formatMoney(totals.paid)}")
        Text("Money in: ${formatMoney(totals.moneyIn)}")
        Text("Money out: ${formatMoney(totals.moneyOut)}")
        ErrorText(viewModel.error)

        Spacer(Modifier.height(12.dp))
        if (viewModel.entries.isEmpty()) {
            Text("No transactions", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (entry in viewModel.entries) {
            val cancelled = entry.status == "cancelled"
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        entry.label,
                        style = MaterialTheme.typography.titleMedium,
                        color = if (cancelled) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                    )
                    Text(
                        "${if (entry.kind == "sale") "Sale" else if (entry.status == "in") "Money in" else "Money out"} · ${stamp(entry.at)} · ${entry.status}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Amount: ${formatMoney(entry.amount)}" +
                            if (entry.kind == "sale") {
                                " · Paid: ${formatMoney(entry.paid)}" +
                                    " · Remaining: ${formatMoney(round2(entry.amount - entry.paid))}"
                            } else {
                                ""
                            },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (entry.kind == "sale" && !cancelled) {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = { onOpenOrder(entry.id) }) { Text("Open") }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

class TransactionDetailViewModel(
    private val transactionsRepository: TransactionsRepository,
    private val orderId: Long,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var detail by mutableStateOf<TransactionsRepository.OrderDetail?>(null)
        private set

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            detail = try {
                transactionsRepository.orderDetail(orderId)
            } catch (e: Exception) {
                error = e.message
                null
            }
        }
    }

    /**
     * Void this order (status -> 'cancelled', row kept). This phase does
     * NOT reverse stock, containers, used oil or the ledger — see
     * [TransactionsRepository]. The confirm text below says only that the
     * order is kept as cancelled.
     */
    fun voidOrder() {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                transactionsRepository.voidOrder(orderId)
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not void order"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun TransactionDetailScreen(
    viewModel: TransactionDetailViewModel,
    onBack: () -> Unit,
) {
    val detail = viewModel.detail
    LubricScreen(title = "Order", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        ErrorText(viewModel.error)
        if (detail == null) {
            Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@LubricScreen
        }
        val order = detail.order
        Text("Order #${order.id}", style = MaterialTheme.typography.titleLarge)
        Text("Status: ${order.status}")
        Text("Date: ${stamp(order.createdAt)}")
        Text("Total: ${formatMoney(round2(order.total ?: 0.0))}")
        Text("Paid: ${formatMoney(round2(order.paidAmount ?: 0.0))}")
        Text(
            "Remaining: ${
                formatMoney(round2((order.total ?: 0.0) - (order.paidAmount ?: 0.0)))
            }",
        )
        if (order.notes.isNotBlank()) {
            Text("Notes: ${order.notes}")
        }
        Spacer(Modifier.height(12.dp))
        Text("Items", style = MaterialTheme.typography.titleMedium)
        if (detail.items.isEmpty()) {
            Text("No items", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (item in detail.items) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(item.productName, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${item.kind} · Qty ${item.qty ?: 0.0} × " +
                            "${formatMoney(item.unitPrice ?: 0.0)} = " +
                            formatMoney(round2(item.lineTotal ?: 0.0)),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        if (order.status == "completed") {
            Spacer(Modifier.height(16.dp))
            // Deliberately NOT "Stock and the ledger are reversed": this
            // phase's void is a status flip only (see repository KDoc).
            OutlinedButton(
                onClick = { viewModel.voidOrder() },
                enabled = !viewModel.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (viewModel.busy) "Voiding…" else "Void order (kept as cancelled)")
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
