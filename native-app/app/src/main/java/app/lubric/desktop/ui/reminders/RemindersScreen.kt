package app.lubric.desktop.ui.reminders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import app.lubric.desktop.data.db.ReminderEntity
import app.lubric.desktop.data.reminders.REMINDER_KINDS
import app.lubric.desktop.data.reminders.ReminderRepository
import app.lubric.desktop.data.reminders.relativeDue
import app.lubric.desktop.data.reminders.reminderBucket
import app.lubric.desktop.data.reminders.reminderKindLabel
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

/** Route string for the Reminders screen; the coordinator wires it into Nav.kt. */
const val REMINDERS_ROUTE = "reminders"

private val TABS = listOf(
    "all" to "All",
    "overdue" to "Overdue",
    "today" to "Today",
    "upcoming" to "Upcoming",
    "done" to "Done",
    "dismissed" to "Dismissed",
)

private val PRIORITIES = listOf("low", "normal", "high")

class RemindersViewModel(
    private val reminderRepository: ReminderRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var tab by mutableStateOf("all")
        private set
    var kindFilter by mutableStateOf("")
        private set
    var reminders by mutableStateOf<List<ReminderEntity>>(emptyList())
        private set

    // Add form state.
    var formVisible by mutableStateOf(false)
        private set
    var formKind by mutableStateOf("todo")
    var formTitle by mutableStateOf("")
    var formDetails by mutableStateOf("")
    var formDueAt by mutableStateOf("")
    var formPriority by mutableStateOf("normal")
    var formCustomerId by mutableStateOf("")
    var formVehicleId by mutableStateOf("")
    var formVendorId by mutableStateOf("")

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            reminders = try {
                // One ordered list, like the web: tabs and counts filter it
                // in memory (see the screen), so counts always agree.
                reminderRepository.reminders(null, kindFilter.ifBlank { null })
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    fun selectTab(value: String) {
        tab = value
    }

    fun selectKindFilter(value: String) {
        kindFilter = value
        refresh()
    }

    fun markDone(id: Long) {
        viewModelScope.launch {
            try {
                reminderRepository.markDone(id)
                refresh()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun markDismissed(id: Long) {
        viewModelScope.launch {
            try {
                reminderRepository.markDismissed(id)
                refresh()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun openAdd() {
        formKind = "todo"
        formTitle = ""
        formDetails = ""
        formDueAt = ""
        formPriority = "normal"
        formCustomerId = ""
        formVehicleId = ""
        formVendorId = ""
        error = null
        formVisible = true
    }

    fun closeForm() {
        formVisible = false
    }

    fun save(shopId: Int) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                reminderRepository.addReminder(
                    kind = formKind,
                    title = formTitle,
                    details = formDetails,
                    dueAt = formDueAt.ifBlank { null },
                    customerId = formCustomerId.toIntOrNull(),
                    vehicleId = formVehicleId.toIntOrNull(),
                    vendorId = formVendorId.toIntOrNull(),
                    priority = formPriority,
                    shopId = shopId,
                )
                formVisible = false
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not save reminder"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun RemindersScreen(
    viewModel: RemindersViewModel,
    shopId: Int,
    onBack: () -> Unit,
) {
    val nowMillis = System.currentTimeMillis()
    // Tab filtering in memory, like the web: overdue/today/upcoming are
    // pending reminders in that urgency bucket; done/dismissed are statuses.
    val filtered = viewModel.reminders.filter { reminder ->
        when (viewModel.tab) {
            "overdue" -> reminder.status == "pending" &&
                reminderBucket(reminder.dueAt, nowMillis) == "overdue"
            "today" -> reminder.status == "pending" &&
                reminderBucket(reminder.dueAt, nowMillis) == "today"
            "upcoming" -> reminder.status == "pending" &&
                reminderBucket(reminder.dueAt, nowMillis) == "upcoming"
            "done" -> reminder.status == "done"
            "dismissed" -> reminder.status == "dismissed"
            else -> true
        }
    }
    fun countFor(tabKey: String): Int = when (tabKey) {
        "overdue" -> viewModel.reminders.count {
            it.status == "pending" && reminderBucket(it.dueAt, nowMillis) == "overdue"
        }
        "today" -> viewModel.reminders.count {
            it.status == "pending" && reminderBucket(it.dueAt, nowMillis) == "today"
        }
        "upcoming" -> viewModel.reminders.count {
            it.status == "pending" && reminderBucket(it.dueAt, nowMillis) == "upcoming"
        }
        "done" -> viewModel.reminders.count { it.status == "done" }
        "dismissed" -> viewModel.reminders.count { it.status == "dismissed" }
        else -> viewModel.reminders.size
    }

    LubricScreen(title = "Reminders", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        // Two rows of three so the tabs fit a phone width (a single Row
        // would clip the last tabs).
        for (tabRow in TABS.chunked(3)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                for ((key, label) in tabRow) {
                    TextButton(onClick = { viewModel.selectTab(key) }) {
                        Text(
                            "$label (${countFor(key)})",
                            color = if (viewModel.tab == key) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        DropdownField(
            label = "Type",
            options = listOf("" to "All types") +
                REMINDER_KINDS.map { it to reminderKindLabel(it) },
            selected = viewModel.kindFilter,
            onSelect = { viewModel.selectKindFilter(it) },
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = { viewModel.openAdd() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("+ New Reminder") }
        ErrorText(viewModel.error)

        if (viewModel.formVisible) {
            Spacer(Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Add Reminder", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    TextField(
                        value = viewModel.formTitle,
                        onValueChange = { viewModel.formTitle = it },
                        label = { Text("Title *") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formDetails,
                        onValueChange = { viewModel.formDetails = it },
                        label = { Text("Details") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    TextField(
                        value = viewModel.formDueAt,
                        onValueChange = { viewModel.formDueAt = it },
                        label = { Text("Due date (YYYY-MM-DD, blank = none)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    DropdownField(
                        label = "Type",
                        options = REMINDER_KINDS.map { it to reminderKindLabel(it) },
                        selected = viewModel.formKind,
                        onSelect = { viewModel.formKind = it },
                    )
                    DropdownField(
                        label = "Priority",
                        options = PRIORITIES.map { it to it },
                        selected = viewModel.formPriority,
                        onSelect = { viewModel.formPriority = it },
                    )
                    TextField(
                        value = viewModel.formCustomerId,
                        onValueChange = { viewModel.formCustomerId = it },
                        label = { Text("Customer id (optional)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formVehicleId,
                        onValueChange = { viewModel.formVehicleId = it },
                        label = { Text("Vehicle id (optional)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formVendorId,
                        onValueChange = { viewModel.formVendorId = it },
                        label = { Text("Vendor id (optional)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { viewModel.save(shopId) },
                            enabled = !viewModel.busy && viewModel.formTitle.isNotBlank(),
                        ) {
                            Text(if (viewModel.busy) "Saving…" else "Save")
                        }
                        OutlinedButton(onClick = { viewModel.closeForm() }) { Text("Cancel") }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        if (filtered.isEmpty()) {
            Text(
                if (viewModel.tab == "all") "No reminders yet" else "No reminders in this view",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        for (reminder in filtered) {
            val bucket = reminderBucket(reminder.dueAt, nowMillis)
            val done = reminder.status == "done"
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        reminder.title,
                        style = MaterialTheme.typography.titleMedium,
                        color = if (done || reminder.status == "dismissed") {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                    )
                    Text(
                        "${reminderKindLabel(reminder.kind)} · ${reminder.priority}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (reminder.details.isNotBlank()) {
                        Text(reminder.details, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(
                        relativeDue(reminder.dueAt, nowMillis) +
                            if (reminder.dueKm != null) " · at ${reminder.dueKm} km" else "",
                        color = if (reminder.status == "pending" && bucket == "overdue") {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    // Who it is about. The web joins customer/vendor/vehicle
                    // names; here only the ids are on the row, so show the
                    // linked id, or "Shop" when nothing is linked.
                    Text(
                        "For: " + when {
                            reminder.customerId != null -> "Customer #${reminder.customerId}"
                            reminder.vendorId != null -> "Vendor #${reminder.vendorId}"
                            reminder.vehicleId != null -> "Vehicle #${reminder.vehicleId}"
                            else -> "Shop"
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (reminder.status == "pending") {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = { viewModel.markDone(reminder.id) }) {
                                Text("Done")
                            }
                            TextButton(onClick = { viewModel.markDismissed(reminder.id) }) {
                                Text("Dismiss")
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun DropdownField(
    label: String,
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    var expanded by mutableStateOf(false)
    val selectedName = options.find { it.first == selected }?.second ?: "—"
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall)
        Box(modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(selectedName)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                for ((value, name) in options) {
                    DropdownMenuItem(
                        text = { Text(name) },
                        onClick = {
                            onSelect(value)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}
