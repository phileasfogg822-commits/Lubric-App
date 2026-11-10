package app.lubric.desktop.ui.vendors

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.db.VendorEntity
import app.lubric.desktop.data.db.VendorPayableEntity
import app.lubric.desktop.data.vendors.VendorRepository
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

/** Routes (coordinator wires these into Nav.kt). */
const val VENDORS_ROUTE = "vendors"
const val VENDOR_DETAIL_ROUTE = "vendor_detail/{vendorId}"

fun vendorDetailRoute(vendorId: Long) = "vendor_detail/$vendorId"

class VendorsViewModel(
    private val vendorRepository: VendorRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var query by mutableStateOf("")
        private set
    var vendors by mutableStateOf<List<VendorEntity>>(emptyList())
        private set

    // Form state (editingId null = add). Same fields as the web form.
    var formVisible by mutableStateOf(false)
        private set
    var editingId by mutableStateOf<Long?>(null)
        private set
    var formName by mutableStateOf("")
    var formContact by mutableStateOf("")
    var formPhone by mutableStateOf("")

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            vendors = try {
                vendorRepository.vendors(query)
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
        formContact = ""
        formPhone = ""
        error = null
        formVisible = true
    }

    fun openEdit(vendor: VendorEntity) {
        editingId = vendor.id
        formName = vendor.name
        formContact = vendor.contact
        formPhone = vendor.phone
        error = null
        formVisible = true
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
                vendorRepository.saveVendor(
                    form = VendorRepository.VendorForm(
                        name = formName,
                        contact = formContact,
                        phone = formPhone,
                    ),
                    shopId = shopId,
                    existingId = editingId,
                )
                formVisible = false
                editingId = null
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not save vendor"
            } finally {
                busy = false
            }
        }
    }
}

class VendorDetailViewModel(
    private val vendorRepository: VendorRepository,
    private val vendorId: Long,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var deleted by mutableStateOf(false)
        private set

    var vendor by mutableStateOf<VendorEntity?>(null)
        private set
    var payables by mutableStateOf<List<VendorPayableEntity>>(emptyList())
        private set
    var ledgerBalance by mutableStateOf(0.0)
        private set

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            try {
                val detail = vendorRepository.vendorDetail(vendorId)
                vendor = detail.vendor
                payables = detail.payables
                ledgerBalance = detail.ledgerBalance
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    /** Soft delete (sets deleted_at); the screen navigates back via [deleted]. */
    fun delete() {
        viewModelScope.launch {
            try {
                vendorRepository.softDeleteVendor(vendorId)
                deleted = true
            } catch (e: Exception) {
                error = e.message
            }
        }
    }
}

@Composable
fun VendorsScreen(
    viewModel: VendorsViewModel,
    shopId: Int,
    onVendorClick: (Long) -> Unit,
    onOpenKhata: (Long) -> Unit,
    onBack: () -> Unit,
) {
    LubricScreen(title = "Vendors", onBack = onBack) {
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
        ) { Text("+ Add Vendor") }
        ErrorText(viewModel.error)

        if (viewModel.formVisible) {
            Spacer(Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        if (viewModel.editingId != null) "Edit Vendor" else "Add Vendor",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    TextField(
                        value = viewModel.formName,
                        onValueChange = { viewModel.formName = it },
                        label = { Text("Company Name *") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formContact,
                        onValueChange = { viewModel.formContact = it },
                        label = { Text("Contact Person") },
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
        if (viewModel.vendors.isEmpty()) {
            Text("No vendors", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (vendor in viewModel.vendors) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(vendor.name, style = MaterialTheme.typography.titleMedium)
                    val contact = listOf(vendor.contact, vendor.phone)
                        .filter { it.isNotBlank() }.joinToString(" · ")
                    if (contact.isNotBlank()) {
                        Text(contact, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    val balance = vendor.payableBalance ?: 0.0
                    if (balance > 0) {
                        Text(
                            "Owes Rs $balance",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { onVendorClick(vendor.id) }) { Text("Details") }
                        TextButton(onClick = { onOpenKhata(vendor.id) }) { Text("Khata") }
                        TextButton(onClick = { viewModel.openEdit(vendor) }) { Text("Edit") }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
fun VendorDetailScreen(
    viewModel: VendorDetailViewModel,
    onBack: () -> Unit,
    onDeleted: () -> Unit,
    onOpenKhata: (Long) -> Unit,
) {
    if (viewModel.deleted) {
        LaunchedEffect(Unit) { onDeleted() }
    }
    val vendor = viewModel.vendor
    LubricScreen(title = vendor?.name ?: "Vendor", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        ErrorText(viewModel.error)
        if (vendor == null) {
            Text("Vendor not found", color = MaterialTheme.colorScheme.error)
            return@LubricScreen
        }
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text(vendor.name, style = MaterialTheme.typography.titleLarge)
                if (vendor.contact.isNotBlank()) Text("Contact: ${vendor.contact}")
                Text("Phone: ${if (vendor.phone.isNotBlank()) vendor.phone else "—"}")
                Text(
                    "Balance (khata): Rs ${viewModel.ledgerBalance}",
                    color = if (viewModel.ledgerBalance > 0) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { onOpenKhata(vendor.id) }) { Text("Khata") }
                    TextButton(onClick = { viewModel.delete() }) { Text("Delete") }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Text("Payables", style = MaterialTheme.typography.titleMedium)
        if (viewModel.payables.isEmpty()) {
            Text("No payables", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (payable in viewModel.payables) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        "Rs ${payable.amount ?: 0.0} — ${payable.status}",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    if (!payable.dueDate.isNullOrBlank()) Text("Due: ${payable.dueDate}")
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
