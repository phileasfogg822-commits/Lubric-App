package app.lubric.desktop.ui.customers

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.db.VehicleEntity
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

class CustomerDetailViewModel(
    private val customerRepository: CustomerRepository,
    private val customerId: Long,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var customer by mutableStateOf<CustomerEntity?>(null)
        private set
    var vehicles by mutableStateOf<List<VehicleEntity>>(emptyList())
        private set
    var recentOrders by mutableStateOf<List<OrderEntity>>(emptyList())
        private set
    var lifetimeTotal by mutableStateOf(0.0)
        private set
    var completedCount by mutableStateOf(0)
        private set

    init {
        load(customerId)
    }

    fun load(id: Long) {
        busy = true
        viewModelScope.launch {
            try {
                val customerIdInt = id.toInt()
                customer = customerRepository.customerById(id)
                vehicles = customerRepository.vehicles(customerIdInt)
                recentOrders = customerRepository.recentOrders(customerIdInt)
                lifetimeTotal = customerRepository.lifetimeTotal(customerIdInt)
                completedCount = customerRepository.completedCount(customerIdInt)
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun CustomerDetailScreen(
    viewModel: CustomerDetailViewModel,
    onBack: () -> Unit,
) {
    val customer = viewModel.customer
    LubricScreen(title = customer?.name ?: "Customer", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        ErrorText(viewModel.error)
        if (viewModel.busy && customer == null) {
            Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@LubricScreen
        }
        if (customer == null) {
            Text("Customer not found", color = MaterialTheme.colorScheme.error)
            return@LubricScreen
        }
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text(customer.name, style = MaterialTheme.typography.titleLarge)
                Text("Phone: ${if (customer.phone.isNotBlank()) customer.phone else "—"}")
                Text("Type: ${customer.customerType}")
                Text("Credit balance: Rs ${customer.creditBalance ?: 0.0}")
                Text("Completed orders: ${viewModel.completedCount}")
                Text("Lifetime spend: Rs ${viewModel.lifetimeTotal}")
            }
        }

        Spacer(Modifier.height(16.dp))
        Text("Vehicles", style = MaterialTheme.typography.titleMedium)
        if (viewModel.vehicles.isEmpty()) {
            Text("No vehicles on file", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (vehicle in viewModel.vehicles) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        vehicle.registration.ifBlank { "No plate" },
                        style = MaterialTheme.typography.titleMedium,
                    )
                    val details = listOf(vehicle.make, vehicle.model, vehicle.modelYear, vehicle.color)
                        .filter { it.isNotBlank() }.joinToString(" ")
                    if (details.isNotBlank()) Text(details)
                    if (vehicle.condition.isNotBlank()) Text("Condition: ${vehicle.condition}")
                    val capacity = vehicle.oilCapacity ?: 0.0
                    if (capacity > 0) Text("Oil capacity: ${capacity}L")
                    val mileage = vehicle.mileage ?: 0
                    if (mileage > 0) Text("Mileage: $mileage km")
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Text("Recent orders", style = MaterialTheme.typography.titleMedium)
        if (viewModel.recentOrders.isEmpty()) {
            Text("No orders yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (order in viewModel.recentOrders) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        "Order #${order.id} — Rs ${order.total ?: 0.0}",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text("Status: ${order.status}")
                    if (!order.createdAt.isNullOrBlank()) Text(order.createdAt)
                    if (order.mileage != null && order.mileage != 0) Text("Mileage: ${order.mileage} km")
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
