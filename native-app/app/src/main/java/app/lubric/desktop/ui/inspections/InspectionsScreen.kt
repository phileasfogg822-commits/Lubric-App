package app.lubric.desktop.ui.inspections

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
import app.lubric.desktop.data.db.CustomerEntity
import app.lubric.desktop.data.db.InspectionEntity
import app.lubric.desktop.data.db.VehicleEntity
import app.lubric.desktop.data.inspections.INSPECTION_CHECKLIST_KEYS
import app.lubric.desktop.data.inspections.INSPECTION_CHECK_VALUES
import app.lubric.desktop.data.inspections.InspectionForm
import app.lubric.desktop.data.inspections.InspectionRepository
import app.lubric.desktop.data.inspections.inspectionChecklistLabel
import app.lubric.desktop.data.inspections.inspectionDataFromJson
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

/** Route string; the coordinator wires this into Nav.kt. */
const val INSPECTIONS_ROUTE = "inspections"

class InspectionsViewModel(
    private val inspectionRepository: InspectionRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var query by mutableStateOf("")
        private set
    var inspections by mutableStateOf<List<InspectionEntity>>(emptyList())
        private set
    var customers by mutableStateOf<List<CustomerEntity>>(emptyList())
        private set
    var vehicles by mutableStateOf<List<VehicleEntity>>(emptyList())
        private set

    // Form state (editingId null = add). Checklist values are stored in
    // inspection_data; unset checks are simply absent from the JSON.
    var formVisible by mutableStateOf(false)
        private set
    var editingId by mutableStateOf<Long?>(null)
        private set
    var formCustomerId by mutableStateOf<Int?>(null)
    var formVehicleId by mutableStateOf<Int?>(null)
    var formOrderId by mutableStateOf("")
    var checks by mutableStateOf<Map<String, String>>(emptyMap())
        private set
    var formFaultCodes by mutableStateOf("")
    var formRecommendations by mutableStateOf("")
    var formNotes by mutableStateOf("")

    init {
        refresh()
        refreshCustomers()
    }

    fun refresh() {
        viewModelScope.launch {
            inspections = try {
                inspectionRepository.inspections(query)
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    private fun refreshCustomers() {
        viewModelScope.launch {
            try {
                customers = inspectionRepository.customers()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun search(q: String) {
        query = q
        refresh()
    }

    fun selectCustomer(customerId: Int?) {
        formCustomerId = customerId
        formVehicleId = null
        vehicles = emptyList()
        if (customerId != null) {
            viewModelScope.launch {
                vehicles = try {
                    inspectionRepository.vehicles(customerId)
                } catch (e: Exception) {
                    error = e.message
                    emptyList()
                }
            }
        }
    }

    fun setCheck(key: String, value: String) {
        checks = checks + (key to value)
    }

    fun openAdd() {
        editingId = null
        formCustomerId = null
        formVehicleId = null
        vehicles = emptyList()
        formOrderId = ""
        checks = emptyMap()
        formFaultCodes = ""
        formRecommendations = ""
        formNotes = ""
        error = null
        formVisible = true
    }

    fun openEdit(inspection: InspectionEntity) {
        editingId = inspection.id
        formCustomerId = inspection.customerId
        formVehicleId = inspection.vehicleId
        formOrderId = inspection.orderId?.toString() ?: ""
        val data = inspectionDataFromJson(
            inspection.inspectionData?.ifBlank { null } ?: inspection.data,
        )
        checks = data.filterKeys { it in INSPECTION_CHECKLIST_KEYS }
        formFaultCodes = data["fault_codes"] ?: ""
        formRecommendations = data["recommendations"] ?: ""
        formNotes = inspection.notes
        error = null
        formVisible = true
        inspection.customerId?.let { selectCustomer(it) }
        // Keep the saved vehicle selected once its list loads.
        formVehicleId = inspection.vehicleId
    }

    fun closeForm() {
        formVisible = false
        editingId = null
    }

    fun save(shopId: Int) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                val data = checks.toMutableMap()
                if (formFaultCodes.isNotBlank()) data["fault_codes"] = formFaultCodes.trim()
                if (formRecommendations.isNotBlank()) {
                    data["recommendations"] = formRecommendations.trim()
                }
                inspectionRepository.saveInspection(
                    form = InspectionForm(
                        customerId = formCustomerId,
                        vehicleId = formVehicleId,
                        orderId = formOrderId.trim().toIntOrNull(),
                        data = data,
                        notes = formNotes,
                    ),
                    shopId = shopId,
                    existingId = editingId,
                )
                formVisible = false
                editingId = null
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not save inspection"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun InspectionsScreen(
    viewModel: InspectionsViewModel,
    shopId: Int,
    onBack: () -> Unit,
) {
    LubricScreen(title = "Inspections", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        TextField(
            value = viewModel.query,
            onValueChange = { viewModel.search(it) },
            label = { Text("Search notes") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = { viewModel.openAdd() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("+ Add Inspection") }
        ErrorText(viewModel.error)

        if (viewModel.formVisible) {
            Spacer(Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        if (viewModel.editingId != null) "Edit Inspection" else "Add Inspection",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    CustomerDropdown(viewModel)
                    Spacer(Modifier.height(8.dp))
                    VehicleDropdown(viewModel)
                    TextField(
                        value = viewModel.formOrderId,
                        onValueChange = { viewModel.formOrderId = it },
                        label = { Text("Order # (optional)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("Checklist", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Tap a result per item; unset items stay out of the record.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    for (key in INSPECTION_CHECKLIST_KEYS) {
                        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                            Text(inspectionChecklistLabel(key))
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                for (value in INSPECTION_CHECK_VALUES) {
                                    val selected = viewModel.checks[key] == value
                                    if (selected) {
                                        Button(onClick = { viewModel.setCheck(key, value) }) {
                                            Text(value)
                                        }
                                    } else {
                                        OutlinedButton(
                                            onClick = { viewModel.setCheck(key, value) },
                                        ) { Text(value) }
                                    }
                                }
                            }
                        }
                    }
                    TextField(
                        value = viewModel.formFaultCodes,
                        onValueChange = { viewModel.formFaultCodes = it },
                        label = { Text("Fault codes") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    TextField(
                        value = viewModel.formRecommendations,
                        onValueChange = { viewModel.formRecommendations = it },
                        label = { Text("Recommendations") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    TextField(
                        value = viewModel.formNotes,
                        onValueChange = { viewModel.formNotes = it },
                        label = { Text("Notes") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { viewModel.save(shopId) },
                            enabled = !viewModel.busy && viewModel.formCustomerId != null,
                        ) {
                            Text(if (viewModel.busy) "Saving…" else "Save")
                        }
                        OutlinedButton(onClick = { viewModel.closeForm() }) { Text("Cancel") }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        if (viewModel.inspections.isEmpty()) {
            Text("No inspections", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (inspection in viewModel.inspections) {
            val customerName = viewModel.customers
                .firstOrNull { it.id.toInt() == inspection.customerId }?.name
            val vehicleReg = viewModel.vehicles
                .firstOrNull { it.id.toInt() == inspection.vehicleId }?.registration
            val data = inspectionDataFromJson(
                inspection.inspectionData?.ifBlank { null } ?: inspection.data,
            )
            val flagged = data.filterKeys { it in INSPECTION_CHECKLIST_KEYS }
                .filterValues { it != "ok" }
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        customerName ?: "—",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        listOfNotNull(vehicleReg, inspection.orderId?.let { "Order #$it" })
                            .joinToString(" · ").ifBlank { "—" },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (flagged.isNotEmpty()) {
                        Text(
                            "Needs attention: " + flagged.entries.joinToString(", ") {
                                "${inspectionChecklistLabel(it.key)} (${it.value})"
                            },
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    if (inspection.notes.isNotBlank()) {
                        Text(
                            inspection.notes,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { viewModel.openEdit(inspection) }) { Text("Edit") }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun CustomerDropdown(viewModel: InspectionsViewModel) {
    var expanded by mutableStateOf(false)
    val selected = viewModel.customers.firstOrNull { it.id.toInt() == viewModel.formCustomerId }
    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Customer: ${selected?.name ?: "Pick a customer"}")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (customer in viewModel.customers) {
                DropdownMenuItem(
                    text = { Text(customer.name) },
                    onClick = {
                        viewModel.selectCustomer(customer.id.toInt())
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun VehicleDropdown(viewModel: InspectionsViewModel) {
    var expanded by mutableStateOf(false)
    val selected = viewModel.vehicles.firstOrNull { it.id.toInt() == viewModel.formVehicleId }
    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
            enabled = viewModel.formCustomerId != null,
        ) {
            Text("Vehicle: ${selected?.registration ?: "Pick a vehicle (optional)"}")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (vehicle in viewModel.vehicles) {
                DropdownMenuItem(
                    text = { Text(vehicle.registration) },
                    onClick = {
                        viewModel.formVehicleId = vehicle.id.toInt()
                        expanded = false
                    },
                )
            }
        }
    }
}
