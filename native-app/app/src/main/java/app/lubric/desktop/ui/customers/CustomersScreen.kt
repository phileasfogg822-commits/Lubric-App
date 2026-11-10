package app.lubric.desktop.ui.customers

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
import app.lubric.desktop.data.customer.CustomerRepository
import app.lubric.desktop.data.db.CustomerEntity
import app.lubric.desktop.data.sale.VehicleFormInput
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

private val CUSTOMER_TYPES = listOf("walking", "returning", "wholesale")

class CustomersViewModel(
    private val customerRepository: CustomerRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var vehicleError by mutableStateOf<String?>(null)
        private set

    var query by mutableStateOf("")
        private set
    var customers by mutableStateOf<List<CustomerEntity>>(emptyList())
        private set

    // Form state (same screen; editingId null = add).
    var formVisible by mutableStateOf(false)
        private set
    var editingId by mutableStateOf<Long?>(null)
        private set
    var formName by mutableStateOf("")
    var formPhone by mutableStateOf("")
    var formType by mutableStateOf("returning")
    var vehicleRegistration by mutableStateOf("")
    var vehicleMake by mutableStateOf("")
    var vehicleModel by mutableStateOf("")
    var vehicleModelYear by mutableStateOf("")
    var vehicleColor by mutableStateOf("")
    var vehicleCondition by mutableStateOf("")

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            customers = try {
                customerRepository.customers(query)
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    fun search(q: String) {
        query = q
        refresh()
    }

    fun openAdd() {
        editingId = null
        formName = ""
        formPhone = ""
        formType = "returning"
        clearVehicleForm()
        vehicleError = null
        error = null
        formVisible = true
    }

    fun openEdit(customer: CustomerEntity) {
        editingId = customer.id
        formName = customer.name
        formPhone = customer.phone
        formType = customer.customerType.ifBlank { "returning" }
        // The web form resets the vehicle empty on edit — it is never
        // prefilled from the customer's vehicles.
        clearVehicleForm()
        vehicleError = null
        error = null
        formVisible = true
    }

    private fun clearVehicleForm() {
        vehicleRegistration = ""
        vehicleMake = ""
        vehicleModel = ""
        vehicleModelYear = ""
        vehicleColor = ""
        vehicleCondition = ""
    }

    fun closeForm() {
        formVisible = false
        editingId = null
    }

    fun save(shopId: Int) {
        if (busy) return
        busy = true
        error = null
        vehicleError = null
        viewModelScope.launch {
            try {
                val result = customerRepository.saveCustomer(
                    form = CustomerRepository.CustomerForm(
                        name = formName,
                        phone = formPhone,
                        customerType = formType,
                        vehicle = VehicleFormInput(
                            registration = vehicleRegistration,
                            make = vehicleMake,
                            model = vehicleModel,
                            modelYear = vehicleModelYear,
                            color = vehicleColor,
                            condition = vehicleCondition,
                        ),
                    ),
                    shopId = shopId,
                    existingId = editingId,
                )
                // A vehicle failure does not undo the saved customer: stay
                // on the list and show it.
                vehicleError = result.vehicleError
                formVisible = false
                editingId = null
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not save customer"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun CustomersScreen(
    viewModel: CustomersViewModel,
    shopId: Int,
    onCustomerClick: (Long) -> Unit,
    onBack: () -> Unit,
) {
    LubricScreen(title = "Customers", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        TextField(
            value = viewModel.query,
            onValueChange = { viewModel.search(it) },
            label = { Text("Search by name or phone") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = { viewModel.openAdd() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("+ Add Customer") }
        ErrorText(viewModel.error)
        viewModel.vehicleError?.let {
            Text(
                "Customer saved, but the vehicle could not be saved: $it",
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
        }

        if (viewModel.formVisible) {
            Spacer(Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        if (viewModel.editingId != null) "Edit Customer" else "Add Customer",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    TextField(
                        value = viewModel.formName,
                        onValueChange = { viewModel.formName = it },
                        label = { Text("Name *") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formPhone,
                        onValueChange = { viewModel.formPhone = it },
                        label = { Text("Phone") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TypeDropdown(viewModel)
                    Spacer(Modifier.height(8.dp))
                    Text("Vehicle (optional)", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Saved with the customer, so the sale screen can pick it up without retyping it.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    TextField(
                        value = viewModel.vehicleRegistration,
                        onValueChange = { viewModel.vehicleRegistration = it },
                        label = { Text("Registration (plate)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.vehicleMake,
                        onValueChange = { viewModel.vehicleMake = it },
                        label = { Text("Make") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.vehicleModel,
                        onValueChange = { viewModel.vehicleModel = it },
                        label = { Text("Model") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.vehicleModelYear,
                        onValueChange = { viewModel.vehicleModelYear = it },
                        label = { Text("Model year") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.vehicleColor,
                        onValueChange = { viewModel.vehicleColor = it },
                        label = { Text("Color") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.vehicleCondition,
                        onValueChange = { viewModel.vehicleCondition = it },
                        label = { Text("Condition") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { viewModel.save(shopId) },
                            enabled = !viewModel.busy && viewModel.formName.isNotBlank(),
                        ) {
                            Text(if (viewModel.busy) "Saving…" else "Save")
                        }
                        OutlinedButton(onClick = { viewModel.closeForm() }) { Text("Cancel") }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        if (viewModel.customers.isEmpty()) {
            Text("No customers", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (customer in viewModel.customers) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(customer.name, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${if (customer.phone.isNotBlank()) customer.phone else "—"} · ${customer.customerType}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    val balance = customer.creditBalance ?: 0.0
                    Text(
                        if (balance > 0) "Balance: Rs $balance" else "Balance: —",
                        color = if (balance > 0) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { onCustomerClick(customer.id) }) { Text("Details") }
                        TextButton(onClick = { viewModel.openEdit(customer) }) { Text("Edit") }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun TypeDropdown(viewModel: CustomersViewModel) {
    var expanded by mutableStateOf(false)
    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Type: ${viewModel.formType}")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (type in CUSTOMER_TYPES) {
                DropdownMenuItem(
                    text = { Text(type) },
                    onClick = {
                        viewModel.formType = type
                        expanded = false
                    },
                )
            }
        }
    }
}
