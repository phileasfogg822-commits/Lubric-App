package app.lubric.desktop.ui.field

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.db.CashMovementEntity
import app.lubric.desktop.data.db.ReservationEntity
import app.lubric.desktop.data.field.FieldRepository
import app.lubric.desktop.data.field.cashMovementKindLabel
import app.lubric.desktop.data.field.fieldTotals
import app.lubric.desktop.data.field.isLinked
import app.lubric.desktop.data.field.isPosted
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import app.lubric.desktop.ui.sale.formatMoney
import java.time.LocalDate
import kotlinx.coroutines.launch

/** Route string for the Field Activity screen; the coordinator wires it into Nav.kt. */
const val FIELD_ROUTE = "field"

private val RANGES = listOf(
    "today" to "Today",
    "7" to "Last 7 days",
    "30" to "Last 30 days",
    "all" to "All time",
)

private val MOVEMENT_KINDS = listOf(
    "" to "All kinds",
    "collection" to "Collections",
    "handover" to "Handovers",
    "expense" to "Expenses",
    "adjustment" to "Adjustments",
)

private val RESERVATION_STATUSES = listOf(
    "" to "All statuses",
    "open" to "Open",
    "fulfilled" to "Fulfilled",
    "cancelled" to "Cancelled",
)

/**
 * Whether a movement timestamp falls in [range], against [today].
 * The web ranges compare `occurred_at` to `CURRENT_DATE` / `now() - interval`;
 * ISO text compares lexicographically, so a "YYYY-MM-DD" cutoff works for
 * full datetimes too.
 */
private fun inRange(occurredAt: String?, range: String, today: LocalDate): Boolean {
    val at = occurredAt ?: ""
    return when (range) {
        "today" -> at.take(10) == today.toString()
        "7" -> at >= today.minusDays(7).toString()
        "30" -> at >= today.minusDays(30).toString()
        else -> true
    }
}

class FieldActivityViewModel(
    private val fieldRepository: FieldRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set

    var range by mutableStateOf("7")
        private set
    var kindFilter by mutableStateOf("")
        private set
    var statusFilter by mutableStateOf("")
        private set
    var movements by mutableStateOf<List<CashMovementEntity>>(emptyList())
        private set
    var reservations by mutableStateOf<List<ReservationEntity>>(emptyList())
        private set

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                movements = fieldRepository.cashMovements(kindFilter.ifBlank { null })
                reservations = fieldRepository.reservations(statusFilter.ifBlank { null })
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun selectRange(value: String) {
        range = value
    }

    fun selectKindFilter(value: String) {
        kindFilter = value
        refresh()
    }

    fun selectStatusFilter(value: String) {
        statusFilter = value
        refresh()
    }
}

@Composable
fun FieldActivityScreen(
    viewModel: FieldActivityViewModel,
    onBack: () -> Unit,
) {
    val today = LocalDate.now()
    // Range filtering is in memory (the DAO filters by kind/status only),
    // and the totals follow the range, like the web.
    val rangedMovements = viewModel.movements.filter {
        inRange(it.occurredAt, viewModel.range, today)
    }
    val rangedReservations = viewModel.reservations.filter {
        inRange(it.createdAt, viewModel.range, today)
    }
    val totals = fieldTotals(rangedMovements)

    LubricScreen(title = "Field Activity", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for ((key, label) in RANGES) {
                TextButton(onClick = { viewModel.selectRange(key) }) {
                    Text(
                        label,
                        color = if (viewModel.range == key) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Text("Collected: ${formatMoney(totals.collected)}")
        Text("Handed over: ${formatMoney(totals.handedOver)}")
        Text("Still in hand: ${formatMoney(totals.inHand)}")
        Text("Records: ${totals.rows}")
        ErrorText(viewModel.error)

        Spacer(Modifier.height(16.dp))
        Text("Collections & handovers", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for ((key, label) in MOVEMENT_KINDS) {
                TextButton(onClick = { viewModel.selectKindFilter(key) }) {
                    Text(
                        label,
                        color = if (viewModel.kindFilter == key) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        if (rangedMovements.isEmpty()) {
            Text(
                "Nothing from the field yet",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        for (movement in rangedMovements) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        cashMovementKindLabel(movement.kind),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        (movement.occurredAt ?: "").replace("T", " ").split(".")[0].take(16),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Customer: ${movement.customerName ?: "—"}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Link: ${if (isLinked(movement)) "Linked" else "Unlinked"} · " +
                            "Posting: ${if (isPosted(movement)) "Posted" else "Not posted"}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Collector: ${movement.takenByName ?: "collector not recorded"}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (movement.note.isNotBlank()) {
                        Text(movement.note, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(
                        (if (movement.kind == "handover") "−" else "") +
                            formatMoney(movement.amount ?: 0.0),
                        color = if (movement.kind == "handover") {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                    )
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Text("Reservations", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for ((key, label) in RESERVATION_STATUSES) {
                TextButton(onClick = { viewModel.selectStatusFilter(key) }) {
                    Text(
                        label,
                        color = if (viewModel.statusFilter == key) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        if (rangedReservations.isEmpty()) {
            Text(
                "No reservations taken in the field for this period.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        for (reservation in rangedReservations) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        reservation.customerName ?: "—",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        (reservation.createdAt ?: "").replace("T", " ").split(".")[0].take(16),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Items: ${reservation.itemsJson}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Status: ${reservation.status} · Amount: ${formatMoney(reservation.amount ?: 0.0)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (reservation.note.isNotBlank()) {
                        Text(reservation.note, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
