package app.lubric.desktop.ui.sale

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
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.db.AccountEntity
import app.lubric.desktop.data.db.ContainerEntity
import app.lubric.desktop.data.db.CustomerEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.ProductEntity
import app.lubric.desktop.data.db.ServiceEntity
import app.lubric.desktop.data.pricing.EMPTY_PRICE_CONTEXT
import app.lubric.desktop.data.pricing.PriceContext
import app.lubric.desktop.data.pricing.PriceMemoryEntry
import app.lubric.desktop.data.pricing.effectiveUnitPrice
import app.lubric.desktop.data.pricing.packLitres
import app.lubric.desktop.data.pricing.resolvePrice
import app.lubric.desktop.data.pricing.PricingRepository
import app.lubric.desktop.data.sale.SaleLineInput
import app.lubric.desktop.data.sale.SaleRepository
import app.lubric.desktop.data.sale.SaleVehicleInput
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

/** One line on the bill. `lineTotal` is always unitPrice * qty. */
data class CartLine(
    val localId: String,
    val kind: String,
    val refId: Int,
    val name: String,
    var qty: Double,
    var unitPrice: Double,
    var capacity: Double,
    var billByCapacity: Boolean,
    var leftoverToContainers: Boolean,
    val containerId: Int?,
    val maxQty: Double?,
    val product: ProductEntity?,
) {
    val lineTotal: Double get() = unitPrice * qty
}

/** "3.50" -> "3.5", "4.0" -> "4". */
fun trimNumber(n: Double): String =
    if (n == kotlin.math.floor(n)) n.toLong().toString() else {
        val rounded = Math.round(n * 100.0) / 100.0
        if (rounded == kotlin.math.floor(rounded)) rounded.toLong().toString()
        else rounded.toString()
    }

fun formatMoney(n: Double): String = "Rs ${trimNumber(n)}"

class SaleViewModel(
    private val db: LubricDatabase,
    private val saleRepository: SaleRepository,
    private val pricingRepository: PricingRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var success by mutableStateOf<String?>(null)
        private set

    // Customer
    var customerQuery by mutableStateOf("")
        private set
    var customerResults by mutableStateOf<List<CustomerEntity>>(emptyList())
        private set
    var selectedCustomer by mutableStateOf<CustomerEntity?>(null)
        private set
    var customerType by mutableStateOf("walking")
        private set
    var priceCtx by mutableStateOf<PriceContext>(EMPTY_PRICE_CONTEXT)
        private set
    var defaultCapacity by mutableStateOf(0.0)
        private set

    // Vehicle form (prefilled from the customer's most recent vehicle).
    var vehicleRegistration by mutableStateOf("")
    var vehicleMake by mutableStateOf("")
    var vehicleModel by mutableStateOf("")
    var vehicleModelYear by mutableStateOf("")
    var vehicleColor by mutableStateOf("")
    var vehicleCondition by mutableStateOf("")
    var mileageText by mutableStateOf("")
    var notes by mutableStateOf("")

    // Catalogue search
    var productQuery by mutableStateOf("")
        private set
    var productResults by mutableStateOf<List<ProductEntity>>(emptyList())
        private set
    var serviceResults by mutableStateOf<List<ServiceEntity>>(emptyList())
        private set
    var openContainers by mutableStateOf<List<ContainerEntity>>(emptyList())
        private set

    // Cart + price memory
    var cart by mutableStateOf<List<CartLine>>(emptyList())
        private set
    var priceMemory by mutableStateOf<Map<Int, List<PriceMemoryEntry>>>(emptyMap())
        private set
    val total: Double get() = cart.sumOf { it.lineTotal }

    // Raw text of the per-line price / capacity fields, so typing "3." is
    // not reformatted mid-keystroke.
    val priceTexts = mutableStateMapOf<String, String>()
    val capacityTexts = mutableStateMapOf<String, String>()

    // Payment
    var accounts by mutableStateOf<List<AccountEntity>>(emptyList())
        private set
    var paymentAccountId by mutableStateOf(1)
        private set

    var usedOilLitres by mutableStateOf("")

    init {
        loadAccounts()
        loadOpenContainers()
    }

    fun clearError() {
        error = null
    }

    private fun loadAccounts() {
        viewModelScope.launch {
            accounts = try {
                db.accountDao().listActive()
            } catch (e: Exception) {
                emptyList()
            }
            if (accounts.none { it.id.toInt() == paymentAccountId }) {
                paymentAccountId = accounts.firstOrNull()?.id?.toInt() ?: 1
            }
        }
    }

    private fun loadOpenContainers() {
        viewModelScope.launch {
            openContainers = try {
                db.containerDao().listOpen()
            } catch (e: Exception) {
                emptyList()
            }
        }
    }

    fun searchCustomers(query: String) {
        customerQuery = query
        viewModelScope.launch {
            customerResults = try {
                if (query.isBlank()) db.customerDao().listAll()
                else db.customerDao().search(query.trim())
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    fun searchProducts(query: String) {
        productQuery = query
        viewModelScope.launch {
            try {
                productResults =
                    if (query.isBlank()) db.productDao().listActive()
                    else db.productDao().searchActive(query.trim())
                serviceResults =
                    if (query.isBlank()) db.serviceDao().listActive()
                    else db.serviceDao().searchActive(query.trim())
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    /** Re-price a product line from its tier price + capacity pro-rating. */
    private fun repriceLine(line: CartLine): CartLine {
        if (line.kind != "product" || line.product == null) return line
        val (tier, _) = resolvePrice(line.product, customerType, line.qty, priceCtx)
        val pack = packLitres(line.product.packing)
        val unit = effectiveUnitPrice(tier, pack, line.capacity, line.billByCapacity)
        return line.copy(unitPrice = unit)
    }

    private fun repriceCart(lines: List<CartLine>): List<CartLine> = lines.map(::repriceLine)

    fun selectCustomer(customer: CustomerEntity?) {
        viewModelScope.launch {
            error = null
            if (customer == null) {
                // Walk-in customer: no price context, no memory, no vehicle.
                selectedCustomer = null
                customerType = "walking"
                priceCtx = EMPTY_PRICE_CONTEXT
                defaultCapacity = 0.0
                priceMemory = emptyMap()
                clearVehicle()
                cart = repriceCart(cart)
                return@launch
            }
            selectedCustomer = customer
            customerType = customer.customerType.ifBlank { "walking" }
            priceCtx = try {
                pricingRepository.loadPriceContext(customer.id.toInt())
            } catch (e: Exception) {
                EMPTY_PRICE_CONTEXT
            }
            // Prefill the vehicle from this customer's most recent vehicle.
            val vehicle = try {
                saleRepository.mostRecentVehicle(customer.id.toInt())
            } catch (e: Exception) {
                null
            }
            if (vehicle != null) {
                val cap = vehicle.oilCapacity ?: 0.0
                defaultCapacity = cap
                vehicleRegistration = vehicle.registration
                vehicleMake = vehicle.make
                vehicleModel = vehicle.model
                vehicleModelYear = vehicle.modelYear
                vehicleColor = vehicle.color
                vehicleCondition = vehicle.condition
                // Prefill the capacity on product lines that have none yet,
                // then re-price so the pro-rating lands.
                if (cap > 0) {
                    cart = cart.map {
                        if (it.kind == "product" && it.capacity <= 0) it.copy(capacity = cap)
                        else it
                    }
                }
            }
            cart = repriceCart(cart)
            refreshPriceMemory()
        }
    }

    // NOTE: named selectCustomerTier, not setCustomerType — the `var
    // customerType` property already generates a setCustomerType setter,
    // and a same-named function is a JVM platform declaration clash.
    fun selectCustomerTier(tier: String) {
        customerType = tier
        cart = repriceCart(cart)
    }

    fun setPaymentAccount(id: Int) {
        paymentAccountId = id
    }

    private fun clearVehicle() {
        vehicleRegistration = ""
        vehicleMake = ""
        vehicleModel = ""
        vehicleModelYear = ""
        vehicleColor = ""
        vehicleCondition = ""
    }

    fun addProduct(product: ProductEntity) {
        val existing = cart.find { it.kind == "product" && it.refId == product.id.toInt() }
        cart = if (existing != null) {
            cart.map {
                if (it.localId == existing.localId) repriceLine(it.copy(qty = it.qty + 1))
                else it
            }
        } else {
            val line = CartLine(
                localId = "p-${product.id}-${System.nanoTime()}",
                kind = "product",
                refId = product.id.toInt(),
                name = product.name,
                qty = 1.0,
                unitPrice = 0.0,
                capacity = defaultCapacity,
                billByCapacity = true,
                leftoverToContainers = true,
                containerId = null,
                maxQty = null,
                product = product,
            )
            cart + repriceLine(line)
        }
        refreshPriceMemory()
    }

    fun addService(service: ServiceEntity) {
        val existing = cart.find { it.kind == "service" && it.refId == service.id.toInt() }
        cart = if (existing != null) {
            cart.map {
                if (it.localId == existing.localId) it.copy(qty = it.qty + 1) else it
            }
        } else {
            cart + CartLine(
                localId = "s-${service.id}-${System.nanoTime()}",
                kind = "service",
                refId = service.id.toInt(),
                name = service.name,
                qty = 1.0,
                unitPrice = service.price ?: 0.0,
                capacity = 0.0,
                billByCapacity = false,
                leftoverToContainers = false,
                containerId = null,
                maxQty = null,
                product = null,
            )
        }
    }

    fun addContainer(container: ContainerEntity) {
        viewModelScope.launch {
            val remaining = container.remainingVolume ?: 0.0
            val existing =
                cart.find { it.kind == "partial_container" && it.containerId == container.id.toInt() }
            if (existing != null) {
                cart = cart.map {
                    if (it.localId == existing.localId && it.qty < remaining) it.copy(qty = it.qty + 1)
                    else it
                }
                return@launch
            }
            val product = container.productId?.let { db.productDao().getById(it.toLong()) }
            val unit = if (product != null) {
                resolvePrice(product, customerType, 1.0, priceCtx).first
            } else 0.0
            val name = if (product != null) {
                "${product.name} (${trimNumber(remaining)}L left)"
            } else {
                "Opened container (${trimNumber(remaining)}L left)"
            }
            cart = cart + CartLine(
                localId = "c-${container.id}-${System.nanoTime()}",
                kind = "partial_container",
                refId = container.id.toInt(),
                name = name,
                qty = 1.0,
                unitPrice = unit,
                capacity = 0.0,
                billByCapacity = false,
                leftoverToContainers = true,
                containerId = container.id.toInt(),
                maxQty = remaining,
                product = product,
            )
        }
    }

    fun changeQty(line: CartLine, delta: Double) {
        val max = line.maxQty ?: Double.MAX_VALUE
        val nq = (line.qty + delta).coerceIn(1.0, max)
        if (nq == line.qty) return
        cart = cart.map {
            if (it.localId == line.localId) repriceLine(it.copy(qty = nq)) else it
        }
    }

    fun updatePrice(line: CartLine, text: String) {
        priceTexts[line.localId] = text
        val value = text.toDoubleOrNull() ?: return
        cart = cart.map {
            if (it.localId == line.localId) it.copy(unitPrice = value) else it
        }
    }

    fun updateCapacity(line: CartLine, text: String) {
        capacityTexts[line.localId] = text
        val value = text.toDoubleOrNull() ?: 0.0
        // Pass the loaded price context here, so the pro-rating lands —
        // the web's updateCapacity omitted it and priced from tier columns.
        cart = cart.map {
            if (it.localId == line.localId) repriceLine(it.copy(capacity = value)) else it
        }
    }

    fun toggleBillByCapacity(line: CartLine) {
        val on = !line.billByCapacity
        cart = cart.map {
            if (it.localId == line.localId) {
                // Turning it on also sends the unused oil back to the
                // containers shelf, matching the web switch.
                repriceLine(it.copy(billByCapacity = on, leftoverToContainers = on))
            } else it
        }
    }

    fun toggleLeftoverToContainers(line: CartLine) {
        cart = cart.map {
            if (it.localId == line.localId) it.copy(leftoverToContainers = !it.leftoverToContainers)
            else it
        }
    }

    fun removeLine(line: CartLine) {
        cart = cart.filter { it.localId != line.localId }
        priceTexts.remove(line.localId)
        capacityTexts.remove(line.localId)
    }

    fun addUsedOil() {
        val litres = usedOilLitres.toDoubleOrNull()
        if (litres == null || litres <= 0) {
            error = "Enter litres of used oil received"
            return
        }
        error = null
        cart = cart + CartLine(
            localId = "uo-${System.nanoTime()}",
            kind = "used_oil",
            refId = 1,
            name = "Used Oil (drop-off)",
            qty = litres,
            unitPrice = 0.0,
            capacity = 0.0,
            billByCapacity = false,
            leftoverToContainers = false,
            containerId = null,
            maxQty = null,
            product = null,
        )
        usedOilLitres = ""
    }

    /** Tap a remembered price: bill this line at that price. */
    fun applyMemoryPrice(line: CartLine, entry: PriceMemoryEntry) {
        priceTexts[line.localId] = trimNumber(entry.unitPrice)
        cart = cart.map {
            if (it.localId == line.localId) it.copy(unitPrice = entry.unitPrice) else it
        }
    }

    fun refreshPriceMemory() {
        val customer = selectedCustomer ?: run {
            priceMemory = emptyMap()
            return
        }
        viewModelScope.launch {
            val productIds = cart.filter { it.kind == "product" }
                .map { it.refId }.distinct()
            if (productIds.isEmpty()) {
                priceMemory = emptyMap()
                return@launch
            }
            val wanted = cart.filter { it.kind == "product" && it.capacity > 0 }
                .associate { it.refId to it.capacity }
            priceMemory = try {
                pricingRepository.priceMemory(customer.id.toInt(), productIds, wanted, 2)
            } catch (e: Exception) {
                emptyMap()
            }
        }
    }

    fun clearCart() {
        cart = emptyList()
        priceTexts.clear()
        capacityTexts.clear()
        notes = ""
        mileageText = ""
        usedOilLitres = ""
        clearVehicle()
    }

    fun completeSale(userId: Int, shopId: Int, onSaleComplete: (Long) -> Unit) {
        if (cart.isEmpty()) {
            error = "Cart is empty"
            return
        }
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                // Vehicle upsert FIRST: the order carries its id.
                var vehicleId: Int? = null
                val customer = selectedCustomer
                if (customer != null && vehicleRegistration.trim().isNotEmpty()) {
                    val oilCap = cart.filter { it.kind == "product" }
                        .maxOfOrNull { it.capacity } ?: 0.0
                    vehicleId = saleRepository.upsertVehicle(
                        customerId = customer.id.toInt(),
                        input = SaleVehicleInput(
                            registration = vehicleRegistration.trim(),
                            make = vehicleMake.trim(),
                            model = vehicleModel.trim(),
                            modelYear = vehicleModelYear.trim(),
                            color = vehicleColor.trim(),
                            condition = vehicleCondition.trim(),
                        ),
                        mileage = mileageText.toIntOrNull() ?: 0,
                        oilCapacity = oilCap,
                        shopId = shopId,
                    )
                }
                val lines = cart.map {
                    SaleLineInput(
                        kind = it.kind,
                        refId = it.refId,
                        name = it.name,
                        qty = it.qty,
                        unitPrice = it.unitPrice,
                        lineTotal = it.lineTotal,
                        containerId = it.containerId,
                        capacity = it.capacity,
                        billByCapacity = it.billByCapacity,
                        leftoverToContainers = it.leftoverToContainers,
                        product = it.product,
                    )
                }
                val result = saleRepository.completeSale(
                    lines = lines,
                    userId = userId,
                    customerId = customer?.id?.toInt(),
                    paymentAccountId = paymentAccountId,
                    total = total,
                    mileage = mileageText.toIntOrNull() ?: 0,
                    notes = notes,
                    vehicleId = vehicleId,
                    shopId = shopId,
                )
                success = "Order #${result.orderId} completed!"
                clearCart()
                onSaleComplete(result.orderId)
            } catch (e: Exception) {
                error = e.message ?: "Sale failed"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun SaleScreen(
    viewModel: SaleViewModel,
    userId: Int,
    shopId: Int,
    onBack: () -> Unit,
    onSaleComplete: (Long) -> Unit,
) {
    LubricScreen(title = "New Sale", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        SectionTitle("Customer")
        TextField(
            value = viewModel.customerQuery,
            onValueChange = { viewModel.searchCustomers(it) },
            label = { Text("Customer name or phone") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        if (viewModel.customerQuery.isNotBlank()) {
            for (c in viewModel.customerResults.take(8)) {
                TextButton(
                    onClick = { viewModel.selectCustomer(c) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "${c.name}${if (c.phone.isNotBlank()) " · ${c.phone}" else ""} (${c.customerType})",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            TextButton(
                onClick = { viewModel.selectCustomer(null) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Walk-in customer", modifier = Modifier.fillMaxWidth())
            }
        }
        viewModel.selectedCustomer?.let { c ->
            Text(
                "Customer: ${c.name} (${c.customerType})",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((tier, label) in listOf("walking" to "W", "returning" to "R", "wholesale" to "Wh")) {
                OutlinedButton(
                    onClick = { viewModel.selectCustomerTier(tier) },
                    enabled = viewModel.customerType != tier,
                ) { Text(label) }
            }
        }
        viewModel.priceCtx.group?.let { group ->
            Text(
                "Billed at the ${group.priceTier} price — ${group.name}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        Spacer(Modifier.height(16.dp))
        SectionTitle("Add items")
        TextField(
            value = viewModel.productQuery,
            onValueChange = { viewModel.searchProducts(it) },
            label = { Text("Search products / services") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        for (p in viewModel.productResults.take(8)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "${p.name}${if (p.packing.isNotBlank()) " · ${p.packing}" else ""} — ${formatMoney(p.priceReturning ?: 0.0)}",
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { viewModel.addProduct(p) }) { Text("Add") }
            }
        }
        for (s in viewModel.serviceResults.take(8)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "${s.name} (service) — ${formatMoney(s.price ?: 0.0)}",
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { viewModel.addService(s) }) { Text("Add") }
            }
        }

        if (viewModel.openContainers.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            SectionTitle("Open containers")
            for (c in viewModel.openContainers) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        "Container #${c.id} — ${trimNumber(c.remainingVolume ?: 0.0)}L left",
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { viewModel.addContainer(c) }) { Text("Add") }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        SectionTitle("Cart")
        if (viewModel.cart.isEmpty()) {
            Text("Cart is empty", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (line in viewModel.cart) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(line.name, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Qty ${trimNumber(line.qty)} × ${formatMoney(line.unitPrice)} = ${formatMoney(line.lineTotal)}",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        OutlinedButton(onClick = { viewModel.changeQty(line, -1.0) }) { Text("−") }
                        OutlinedButton(onClick = { viewModel.changeQty(line, 1.0) }) { Text("+") }
                        TextButton(onClick = { viewModel.removeLine(line) }) { Text("Remove") }
                    }
                    TextField(
                        value = viewModel.priceTexts[line.localId]
                            ?: trimNumber(line.unitPrice),
                        onValueChange = { viewModel.updatePrice(line, it) },
                        label = { Text("Unit price") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                    if (line.kind == "product") {
                        Spacer(Modifier.height(8.dp))
                        TextField(
                            value = viewModel.capacityTexts[line.localId]
                                ?: if (line.capacity > 0) trimNumber(line.capacity) else "",
                            onValueChange = { viewModel.updateCapacity(line, it) },
                            label = { Text("Engine capacity (L)") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { viewModel.toggleBillByCapacity(line) }) {
                                Text("Bill by capacity: ${if (line.billByCapacity) "On" else "Off"}")
                            }
                            TextButton(onClick = { viewModel.toggleLeftoverToContainers(line) }) {
                                Text("Leftover to containers: ${if (line.leftoverToContainers) "Yes" else "No"}")
                            }
                        }
                        val memory = viewModel.priceMemory[line.refId]?.firstOrNull()
                        if (memory != null) {
                            TextButton(
                                onClick = { viewModel.applyMemoryPrice(line, memory) },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    "Last: ${trimNumber(memory.litres)}L · ${formatMoney(memory.unitPrice)}" +
                                        if (!memory.date.isNullOrBlank()) " · ${memory.date.take(10)}" else "" +
                                        " — tap to apply",
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        SectionTitle("Used oil")
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TextField(
                value = viewModel.usedOilLitres,
                onValueChange = { viewModel.usedOilLitres = it },
                label = { Text("Litres received") },
                modifier = Modifier.weight(1f),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            Button(onClick = { viewModel.addUsedOil() }) { Text("Add") }
        }

        Spacer(Modifier.height(16.dp))
        SectionTitle("Vehicle")
        TextField(
            value = viewModel.vehicleRegistration,
            onValueChange = { viewModel.vehicleRegistration = it },
            label = { Text("Registration") },
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
            label = { Text("Colour") },
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
        TextField(
            value = viewModel.mileageText,
            onValueChange = { viewModel.mileageText = it },
            label = { Text("Mileage (km)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        TextField(
            value = viewModel.notes,
            onValueChange = { viewModel.notes = it },
            label = { Text("Notes") },
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(16.dp))
        SectionTitle("Payment")
        AccountDropdown(viewModel)

        Spacer(Modifier.height(16.dp))
        Text(
            "Total: ${formatMoney(viewModel.total)}",
            style = MaterialTheme.typography.titleLarge,
        )
        viewModel.success?.let {
            Text(it, color = MaterialTheme.colorScheme.primary)
        }
        ErrorText(viewModel.error)
        Button(
            onClick = { viewModel.completeSale(userId, shopId, onSaleComplete) },
            enabled = !viewModel.busy && viewModel.cart.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        ) {
            Text(if (viewModel.busy) "Completing…" else "Complete Sale")
        }
        OutlinedButton(
            onClick = { viewModel.clearCart() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Clear cart") }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(vertical = 4.dp))
}

@Composable
private fun AccountDropdown(viewModel: SaleViewModel) {
    var expanded by mutableStateOf(false)
    val selected = viewModel.accounts.find { it.id.toInt() == viewModel.paymentAccountId }
    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Account: ${selected?.name ?: "Account ${viewModel.paymentAccountId}"}")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (account in viewModel.accounts) {
                DropdownMenuItem(
                    text = { Text(account.name) },
                    onClick = {
                        viewModel.setPaymentAccount(account.id.toInt())
                        expanded = false
                    },
                )
            }
        }
    }
}
