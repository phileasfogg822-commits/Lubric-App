package app.lubric.desktop.ui.purchases

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.db.ProductEntity
import app.lubric.desktop.data.db.VendorEntity
import app.lubric.desktop.data.pricing.round2
import app.lubric.desktop.data.purchases.PurchaseLineInput
import app.lubric.desktop.data.purchases.PurchaseOrderDetail
import app.lubric.desktop.data.purchases.PurchaseRepository
import app.lubric.desktop.data.purchases.purchaseLineTotal
import app.lubric.desktop.data.purchases.purchaseOrderTotal
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

/** Route strings; the coordinator wires these into Nav.kt. */
const val PURCHASES_ROUTE = "purchases"
const val PURCHASE_DETAIL_ROUTE = "purchase_detail/{purchaseOrderId}"

fun purchaseDetailRoute(purchaseOrderId: Long) = "purchase_detail/$purchaseOrderId"

/** One line in the create form (already validated numbers). */
data class PurchaseLineDraft(
    val productId: Int,
    val productName: String,
    val qty: Double,
    val unitCost: Double,
)

class PurchasesViewModel(
    private val purchaseRepository: PurchaseRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var orders by mutableStateOf<List<app.lubric.desktop.data.db.PurchaseOrderEntity>>(emptyList())
        private set
    var detail by mutableStateOf<PurchaseOrderDetail?>(null)
        private set
    var vendors by mutableStateOf<List<VendorEntity>>(emptyList())
        private set
    var products by mutableStateOf<List<ProductEntity>>(emptyList())
        private set

    // Create-form state.
    var formVisible by mutableStateOf(false)
        private set
    var formVendorId by mutableStateOf<Int?>(null)
    var formNotes by mutableStateOf("")
    var lines by mutableStateOf<List<PurchaseLineDraft>>(emptyList())
        private set
    var newProductId by mutableStateOf<Int?>(null)
    var newQty by mutableStateOf("")
    var newUnitCost by mutableStateOf("")

    init {
        refresh()
        refreshPickers()
    }

    fun refresh() {
        viewModelScope.launch {
            orders = try {
                purchaseRepository.purchaseOrders()
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    private fun refreshPickers() {
        viewModelScope.launch {
            try {
                vendors = purchaseRepository.vendors()
                products = purchaseRepository.activeProducts()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun loadDetail(id: Long) {
        viewModelScope.launch {
            detail = try {
                purchaseRepository.purchaseOrderDetail(id)
            } catch (e: Exception) {
                error = e.message
                null
            }
            if (detail == null && error == null) error = "Purchase order not found"
        }
    }

    fun openAdd() {
        formVendorId = null
        formNotes = ""
        lines = emptyList()
        newProductId = null
        newQty = ""
        newUnitCost = ""
        error = null
        formVisible = true
    }

    fun closeForm() {
        formVisible = false
    }

    fun addLine() {
        val product = products.firstOrNull { it.id.toInt() == newProductId } ?: run {
            error = "Pick a product for the line"
            return
        }
        val qty = newQty.toDoubleOrNull()
        val unitCost = newUnitCost.toDoubleOrNull()
        if (qty == null || qty <= 0.0) {
            error = "Quantity must be more than 0 for ${product.name}"
            return
        }
        if (unitCost == null || unitCost < 0.0) {
            error = "Unit cost cannot be negative for ${product.name}"
            return
        }
        lines = lines + PurchaseLineDraft(
            productId = product.id.toInt(),
            productName = product.name,
            qty = qty,
            unitCost = unitCost,
        )
        newProductId = null
        newQty = ""
        newUnitCost = ""
        error = null
    }

    fun removeLine(index: Int) {
        lines = lines.filterIndexed { i, _ -> i != index }
    }

    fun formTotal(): Double = purchaseOrderTotal(
        lines.map { PurchaseLineInput(it.productId, it.productName, it.qty, it.unitCost) },
    )

    fun save(shopId: Int) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                purchaseRepository.createPurchaseOrder(
                    vendorId = formVendorId,
                    items = lines.map {
                        PurchaseLineInput(it.productId, it.productName, it.qty, it.unitCost)
                    },
                    notes = formNotes,
                    shopId = shopId,
                )
                formVisible = false
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not save purchase order"
            } finally {
                busy = false
            }
        }
    }

    fun receive(id: Long) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                purchaseRepository.receivePurchaseOrder(id)
                loadDetail(id)
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not receive purchase order"
            } finally {
                busy = false
            }
        }
    }

    fun cancel(id: Long) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                purchaseRepository.cancelPurchaseOrder(id)
                loadDetail(id)
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not cancel purchase order"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun PurchasesScreen(
    viewModel: PurchasesViewModel,
    shopId: Int,
    onPurchaseClick: (Long) -> Unit,
    onBack: () -> Unit,
) {
    LubricScreen(title = "Purchases", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = { viewModel.openAdd() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("+ New Purchase Order") }
        ErrorText(viewModel.error)

        if (viewModel.formVisible) {
            Spacer(Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("New Purchase Order", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    VendorDropdown(viewModel)
                    Spacer(Modifier.height(8.dp))
                    TextField(
                        value = viewModel.formNotes,
                        onValueChange = { viewModel.formNotes = it },
                        label = { Text("Notes") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("Lines", style = MaterialTheme.typography.titleSmall)
                    for ((index, line) in viewModel.lines.withIndex()) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                "${line.productName} · ${line.qty} × Rs ${line.unitCost} = " +
                                    "Rs ${purchaseLineTotal(line.qty, line.unitCost)}",
                            )
                            TextButton(onClick = { viewModel.removeLine(index) }) { Text("Remove") }
                        }
                    }
                    Text(
                        "Total: Rs ${round2(viewModel.formTotal())}",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Spacer(Modifier.height(8.dp))
                    ProductDropdown(viewModel)
                    TextField(
                        value = viewModel.newQty,
                        onValueChange = { viewModel.newQty = it },
                        label = { Text("Quantity") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    )
                    TextField(
                        value = viewModel.newUnitCost,
                        onValueChange = { viewModel.newUnitCost = it },
                        label = { Text("Unit cost") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { viewModel.addLine() },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Add line") }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { viewModel.save(shopId) },
                            enabled = !viewModel.busy && viewModel.lines.isNotEmpty(),
                        ) {
                            Text(if (viewModel.busy) "Saving…" else "Save draft")
                        }
                        OutlinedButton(onClick = { viewModel.closeForm() }) { Text("Cancel") }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        if (viewModel.orders.isEmpty()) {
            Text("No purchase orders", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (order in viewModel.orders) {
            val vendorName = viewModel.vendors.firstOrNull { it.id.toInt() == order.vendorId }?.name
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        "Order #${order.id} · ${order.status}",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        "${vendorName ?: "—"} · Rs ${order.total ?: 0.0}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (order.notes.isNotBlank()) {
                        Text(order.notes, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { onPurchaseClick(order.id) }) { Text("Details") }
                        if (order.status == "draft") {
                            TextButton(
                                onClick = { viewModel.receive(order.id) },
                                enabled = !viewModel.busy,
                            ) { Text("Receive") }
                            TextButton(
                                onClick = { viewModel.cancel(order.id) },
                                enabled = !viewModel.busy,
                            ) { Text("Cancel") }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
fun PurchaseDetailScreen(
    viewModel: PurchasesViewModel,
    purchaseOrderId: Long,
    onBack: () -> Unit,
) {
    LaunchedEffect(purchaseOrderId) { viewModel.loadDetail(purchaseOrderId) }
    LubricScreen(title = "Purchase Order #$purchaseOrderId", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        ErrorText(viewModel.error)
        val detail = viewModel.detail
        if (detail == null) {
            Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@LubricScreen
        }
        val order = detail.order
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Status: ${order.status}", style = MaterialTheme.typography.titleMedium)
                Text("Vendor: ${detail.vendorName ?: "—"}")
                Text("Total: Rs ${order.total ?: 0.0}")
                Text("Paid: Rs ${order.paid ?: 0.0}")
                if (order.notes.isNotBlank()) Text("Notes: ${order.notes}")
                if (order.createdAt != null) Text("Created: ${order.createdAt}")
            }
        }
        Spacer(Modifier.height(12.dp))
        Text("Lines", style = MaterialTheme.typography.titleSmall)
        for (item in detail.items) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(item.productName, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${item.qty ?: 0.0} × Rs ${item.unitCost ?: 0.0} = " +
                            "Rs ${item.lineTotal ?: 0.0}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        if (order.status == "draft") {
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { viewModel.receive(order.id) },
                    enabled = !viewModel.busy,
                ) { Text(if (viewModel.busy) "Working…" else "Receive stock") }
                OutlinedButton(
                    onClick = { viewModel.cancel(order.id) },
                    enabled = !viewModel.busy,
                ) { Text("Cancel order") }
            }
            Text(
                "Receiving adds every line to stock (purchase movement + stock levels).",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun VendorDropdown(viewModel: PurchasesViewModel) {
    var expanded by mutableStateOf(false)
    val selected = viewModel.vendors.firstOrNull { it.id.toInt() == viewModel.formVendorId }
    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Vendor: ${selected?.name ?: "Pick a vendor"}")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (vendor in viewModel.vendors) {
                DropdownMenuItem(
                    text = { Text(vendor.name) },
                    onClick = {
                        viewModel.formVendorId = vendor.id.toInt()
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun ProductDropdown(viewModel: PurchasesViewModel) {
    var expanded by mutableStateOf(false)
    val selected = viewModel.products.firstOrNull { it.id.toInt() == viewModel.newProductId }
    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Product: ${selected?.name ?: "Pick a product"}")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (product in viewModel.products) {
                DropdownMenuItem(
                    text = { Text(product.name) },
                    onClick = {
                        viewModel.newProductId = product.id.toInt()
                        // Default the cost from the product's cost price.
                        viewModel.newUnitCost = (product.costPrice ?: 0.0).toString()
                        expanded = false
                    },
                )
            }
        }
    }
}
