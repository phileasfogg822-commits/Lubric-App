package app.lubric.desktop.ui.products

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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.catalog.CatalogRepository
import app.lubric.desktop.data.db.BrandEntity
import app.lubric.desktop.data.db.CategoryEntity
import app.lubric.desktop.data.db.ProductEntity
import app.lubric.desktop.data.db.VendorEntity
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

class ProductsViewModel(
    private val catalogRepository: CatalogRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var query by mutableStateOf("")
        private set
    var products by mutableStateOf<List<ProductEntity>>(emptyList())
        private set
    var categories by mutableStateOf<List<CategoryEntity>>(emptyList())
        private set
    var brands by mutableStateOf<List<BrandEntity>>(emptyList())
        private set
    var vendors by mutableStateOf<List<VendorEntity>>(emptyList())
        private set

    // Form state (editingId null = add). All web fields, as typed strings.
    var formVisible by mutableStateOf(false)
        private set
    var editingId by mutableStateOf<Long?>(null)
        private set
    var formName by mutableStateOf("")
    var formPacking by mutableStateOf("")
    var formBrandId by mutableStateOf<Int?>(null)
    var formCategoryId by mutableStateOf<Int?>(null)
    var formVendorId by mutableStateOf<Int?>(null)
    var formUnit by mutableStateOf("piece")
    var formVariant by mutableStateOf("")
    var formOffer by mutableStateOf("")
    var formMfdDate by mutableStateOf("")
    var formExpDate by mutableStateOf("")
    var formReceivedDate by mutableStateOf("")
    var formStockQty by mutableStateOf("0")
    var formPriceReturning by mutableStateOf("")
    var formPriceWalking by mutableStateOf("")
    var formPriceWholesale by mutableStateOf("")
    var formWholesaleMinQty by mutableStateOf("10")
    var formLowStockThreshold by mutableStateOf("5")
    var newCategoryName by mutableStateOf("")
    var newBrandName by mutableStateOf("")

    init {
        refresh()
        refreshLists()
    }

    fun refresh() {
        viewModelScope.launch {
            products = try {
                // All products, active and hidden, so a hidden product can
                // be shown again from this same list.
                catalogRepository.productsAll(query)
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    fun refreshLists() {
        viewModelScope.launch {
            try {
                categories = catalogRepository.categories()
                brands = catalogRepository.brands()
                vendors = catalogRepository.vendors()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun search(q: String) {
        query = q
        refresh()
    }

    private fun resetForm() {
        formName = ""
        formPacking = ""
        formBrandId = null
        formCategoryId = null
        formVendorId = null
        formUnit = "piece"
        formVariant = ""
        formOffer = ""
        formMfdDate = ""
        formExpDate = ""
        formReceivedDate = ""
        formStockQty = "0"
        formPriceReturning = ""
        formPriceWalking = ""
        formPriceWholesale = ""
        formWholesaleMinQty = "10"
        formLowStockThreshold = "5"
        newCategoryName = ""
        newBrandName = ""
    }

    fun openAdd() {
        editingId = null
        resetForm()
        error = null
        formVisible = true
    }

    fun openEdit(product: ProductEntity) {
        editingId = product.id
        formName = product.name
        formPacking = product.packing
        formBrandId = product.brandId
        formCategoryId = product.categoryId
        formVendorId = product.vendorId
        formUnit = product.unit.ifBlank { "piece" }
        formVariant = product.variant
        formOffer = product.offer
        formMfdDate = product.mfdDate
        formExpDate = product.expDate
        formReceivedDate = product.receivedDate ?: ""
        formStockQty = (product.stockQty ?: 0.0).toString()
        formPriceReturning = (product.priceReturning ?: 0.0).toString()
        formPriceWalking = product.priceWalking?.toString() ?: ""
        formPriceWholesale = (product.priceWholesale ?: 0.0).toString()
        formWholesaleMinQty = (product.wholesaleMinQty ?: 10.0).toString()
        formLowStockThreshold = (product.lowStockThreshold ?: 5.0).toString()
        newCategoryName = ""
        newBrandName = ""
        error = null
        formVisible = true
    }

    fun closeForm() {
        formVisible = false
        editingId = null
    }

    fun addCategoryInline(shopId: Int) {
        val name = newCategoryName.trim()
        if (name.isBlank()) return
        viewModelScope.launch {
            try {
                val created = catalogRepository.addCategory(name, shopId)
                categories = catalogRepository.categories()
                formCategoryId = created.id.toInt()
                newCategoryName = ""
            } catch (e: Exception) {
                error = e.message ?: "Could not add category"
            }
        }
    }

    fun addBrandInline(shopId: Int) {
        val name = newBrandName.trim()
        if (name.isBlank()) return
        viewModelScope.launch {
            try {
                val created = catalogRepository.addBrand(name, shopId)
                brands = catalogRepository.brands()
                formBrandId = created.id.toInt()
                newBrandName = ""
            } catch (e: Exception) {
                error = e.message ?: "Could not add brand"
            }
        }
    }

    fun save(shopId: Int) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                catalogRepository.saveProduct(
                    form = CatalogRepository.ProductForm(
                        name = formName,
                        packing = formPacking,
                        brandId = formBrandId,
                        categoryId = formCategoryId,
                        vendorId = formVendorId,
                        unit = formUnit,
                        variant = formVariant,
                        offer = formOffer,
                        mfdDate = formMfdDate,
                        expDate = formExpDate,
                        receivedDate = formReceivedDate,
                        stockQty = formStockQty,
                        priceReturning = formPriceReturning,
                        priceWalking = formPriceWalking,
                        priceWholesale = formPriceWholesale,
                        wholesaleMinQty = formWholesaleMinQty,
                        lowStockThreshold = formLowStockThreshold,
                    ),
                    shopId = shopId,
                    existingId = editingId,
                )
                formVisible = false
                editingId = null
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not save product"
            } finally {
                busy = false
            }
        }
    }

    fun toggleActive(product: ProductEntity) {
        viewModelScope.launch {
            try {
                catalogRepository.setProductActive(product.id, !product.active)
                refresh()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }
}

@Composable
fun ProductsScreen(
    viewModel: ProductsViewModel,
    shopId: Int,
    onBack: () -> Unit,
) {
    LubricScreen(title = "Products", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        TextField(
            value = viewModel.query,
            onValueChange = { viewModel.search(it) },
            label = { Text("Search products") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = { viewModel.openAdd() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("+ Add Product") }
        ErrorText(viewModel.error)

        if (viewModel.formVisible) {
            Spacer(Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        if (viewModel.editingId != null) "Edit Product" else "Add Product",
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
                        value = viewModel.formPacking,
                        onValueChange = { viewModel.formPacking = it },
                        label = { Text("Packing (e.g. 4L / 1kg / 1pc)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    DropdownField(
                        label = "Company (brand)",
                        options = viewModel.brands.map { it.id.toInt() to it.name },
                        selected = viewModel.formBrandId,
                        onSelect = { viewModel.formBrandId = it },
                        emptyText = "No brands yet — add one below",
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        TextField(
                            value = viewModel.newBrandName,
                            onValueChange = { viewModel.newBrandName = it },
                            label = { Text("New company name") },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                        )
                        Button(
                            onClick = { viewModel.addBrandInline(shopId) },
                            enabled = viewModel.newBrandName.isNotBlank(),
                        ) { Text("Add") }
                    }
                    DropdownField(
                        label = "Category",
                        options = viewModel.categories.map { it.id.toInt() to it.name },
                        selected = viewModel.formCategoryId,
                        onSelect = { viewModel.formCategoryId = it },
                        emptyText = "No categories yet — add one below",
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        TextField(
                            value = viewModel.newCategoryName,
                            onValueChange = { viewModel.newCategoryName = it },
                            label = { Text("New category name") },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                        )
                        Button(
                            onClick = { viewModel.addCategoryInline(shopId) },
                            enabled = viewModel.newCategoryName.isNotBlank(),
                        ) { Text("Add") }
                    }
                    DropdownField(
                        label = "Supplier",
                        options = viewModel.vendors.map { it.id.toInt() to it.name },
                        selected = viewModel.formVendorId,
                        onSelect = { viewModel.formVendorId = it },
                        emptyText = "No suppliers yet",
                    )
                    TextField(
                        value = viewModel.formUnit,
                        onValueChange = { viewModel.formUnit = it },
                        label = { Text("Unit") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formVariant,
                        onValueChange = { viewModel.formVariant = it },
                        label = { Text("Variant") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formOffer,
                        onValueChange = { viewModel.formOffer = it },
                        label = { Text("Offer") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formMfdDate,
                        onValueChange = { viewModel.formMfdDate = it },
                        label = { Text("Mfg date (YYYY-MM-DD)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formExpDate,
                        onValueChange = { viewModel.formExpDate = it },
                        label = { Text("Expiry date (YYYY-MM-DD)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TextField(
                        value = viewModel.formReceivedDate,
                        onValueChange = { viewModel.formReceivedDate = it },
                        label = { Text("Date received (YYYY-MM-DD)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    NumberField("Stock qty", viewModel.formStockQty) { viewModel.formStockQty = it }
                    NumberField("Returning price", viewModel.formPriceReturning) { viewModel.formPriceReturning = it }
                    TextField(
                        value = viewModel.formPriceWalking,
                        onValueChange = { viewModel.formPriceWalking = it },
                        label = { Text("Walk-in price (blank = same as returning)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                    NumberField("Wholesale price", viewModel.formPriceWholesale) { viewModel.formPriceWholesale = it }
                    NumberField("Wholesale min qty", viewModel.formWholesaleMinQty) { viewModel.formWholesaleMinQty = it }
                    NumberField("Low stock alert", viewModel.formLowStockThreshold) { viewModel.formLowStockThreshold = it }
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
        if (viewModel.products.isEmpty()) {
            Text("No products", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (product in viewModel.products) {
            val stock = product.stockQty ?: 0.0
            val threshold = product.lowStockThreshold ?: 5.0
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        product.name + if (product.active) "" else " (hidden)",
                        style = MaterialTheme.typography.titleMedium,
                        color = if (product.active) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "${if (product.packing.isNotBlank()) product.packing + " · " else ""}" +
                            "Stock: $stock · Returning: Rs ${product.priceReturning ?: 0.0}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (stock <= threshold) {
                        Text("Low stock", color = MaterialTheme.colorScheme.error)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { viewModel.openEdit(product) }) { Text("Edit") }
                        TextButton(onClick = { viewModel.toggleActive(product) }) {
                            Text(if (product.active) "Hide" else "Show")
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun NumberField(label: String, value: String, onChange: (String) -> Unit) {
    TextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    )
}

@Composable
private fun DropdownField(
    label: String,
    options: List<Pair<Int?, String>>,
    selected: Int?,
    onSelect: (Int?) -> Unit,
    emptyText: String,
) {
    var expanded by mutableStateOf(false)
    val selectedName = options.find { it.first == selected }?.second ?: "—"
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall)
        if (options.isEmpty()) {
            Text(emptyText, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Box(modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(selectedName)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                DropdownMenuItem(
                    text = { Text("—") },
                    onClick = {
                        onSelect(null)
                        expanded = false
                    },
                )
                for ((id, name) in options) {
                    DropdownMenuItem(
                        text = { Text(name) },
                        onClick = {
                            onSelect(id)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}
