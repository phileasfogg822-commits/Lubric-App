package app.lubric.desktop.ui.khata

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
import app.lubric.desktop.data.db.AccountEntity
import app.lubric.desktop.data.ledger.LedgerRepository
import app.lubric.desktop.data.ledger.MonthlyRow
import app.lubric.desktop.data.ledger.PartyBalanceRow
import app.lubric.desktop.data.ledger.StatementView
import app.lubric.desktop.data.ledger.monthKey
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import java.time.LocalDate
import kotlinx.coroutines.launch

/** Route (coordinator wires this into Nav.kt). */
const val KHATA_ROUTE = "khata"

class KhataViewModel(
    private val ledgerRepository: LedgerRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var partyType by mutableStateOf("customer")
        private set
    var parties by mutableStateOf<List<PartyBalanceRow>>(emptyList())
        private set
    var selectedPartyId by mutableStateOf<Long?>(null)
        private set
    var statement by mutableStateOf<StatementView?>(null)
        private set
    var monthly by mutableStateOf<List<MonthlyRow>>(emptyList())
        private set
    var accounts by mutableStateOf<List<AccountEntity>>(emptyList())
        private set

    // Entry form (bill or payment, web PostEntryModal fields).
    var entryKind by mutableStateOf("payment") // "payment" | "bill"
        private set
    var formVisible by mutableStateOf(false)
        private set
    var formAmount by mutableStateOf("")
    var formNote by mutableStateOf("")
    var formDate by mutableStateOf(LocalDate.now().toString())
    var formDueDate by mutableStateOf("")
    var formAccountId by mutableStateOf<Long?>(null)

    val selectedParty: PartyBalanceRow?
        get() = parties.find { it.partyId == selectedPartyId }

    init {
        loadParties()
        refreshAccounts()
    }

    fun refreshAccounts() {
        viewModelScope.launch {
            accounts = try {
                ledgerRepository.accounts()
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    fun loadParties(initialPartyId: Long? = null) {
        viewModelScope.launch {
            try {
                parties = ledgerRepository.listParties(partyType)
                val target = initialPartyId ?: selectedPartyId
                if (target != null && parties.any { it.partyId == target }) {
                    selectParty(target)
                } else {
                    selectedPartyId = null
                    statement = null
                    monthly = emptyList()
                }
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun selectPartyType(type: String) {
        if (type == partyType) return
        partyType = type
        selectedPartyId = null
        statement = null
        monthly = emptyList()
        formVisible = false
        loadParties()
    }

    fun selectParty(partyId: Long) {
        selectedPartyId = partyId
        viewModelScope.launch {
            try {
                statement = ledgerRepository.statement(partyType, partyId)
                monthly = ledgerRepository.monthlySummary(partyType, partyId)
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun openEntry(kind: String) {
        entryKind = kind
        // Web PostEntryModal prefills the amount with the balance when positive.
        formAmount = selectedParty?.let { if (it.balance > 0.005) it.balance.toString() else "" } ?: ""
        formNote = ""
        formDate = LocalDate.now().toString()
        formDueDate = ""
        formAccountId = null
        error = null
        formVisible = true
    }

    fun closeEntry() {
        formVisible = false
    }

    fun submitEntry(shopId: Int) {
        val partyId = selectedPartyId ?: return
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                val amount = formAmount.toDoubleOrNull()
                    ?: throw IllegalArgumentException("Enter an amount")
                if (entryKind == "payment") {
                    ledgerRepository.recordPayment(
                        partyType = partyType,
                        partyId = partyId,
                        amount = amount,
                        accountId = formAccountId,
                        note = formNote,
                        shopId = shopId,
                        occurredAt = formDate.ifBlank { LocalDate.now().toString() },
                    )
                } else {
                    ledgerRepository.recordBill(
                        partyType = partyType,
                        partyId = partyId,
                        amount = amount,
                        note = formNote,
                        dueDate = formDueDate.ifBlank { null },
                        shopId = shopId,
                        occurredAt = formDate.ifBlank { LocalDate.now().toString() },
                    )
                }
                formVisible = false
                loadParties(partyId)
            } catch (e: Exception) {
                error = e.message ?: "Could not save entry"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun KhataScreen(
    viewModel: KhataViewModel,
    shopId: Int,
    onBack: () -> Unit,
    initialPartyType: String = "customer",
    initialPartyId: Long? = null,
) {
    // Deep link from a vendor row (?type=vendor&id=…): apply once on entry.
    androidx.compose.runtime.LaunchedEffect(initialPartyType, initialPartyId) {
        if (initialPartyType == "vendor" && viewModel.partyType != "vendor") {
            viewModel.selectPartyType("vendor")
        }
        if (initialPartyId != null) viewModel.loadParties(initialPartyId)
    }
    val customer = viewModel.partyType == "customer"
    LubricScreen(title = "Khata", onBack = onBack) {
        Spacer(Modifier.height(12.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { viewModel.selectPartyType("customer") },
                enabled = !customer,
                modifier = Modifier.weight(1f),
            ) { Text("Customers") }
            Button(
                onClick = { viewModel.selectPartyType("vendor") },
                enabled = customer,
                modifier = Modifier.weight(1f),
            ) { Text("Vendors") }
        }
        Spacer(Modifier.height(12.dp))

        PartyDropdown(viewModel)
        ErrorText(viewModel.error)

        val party = viewModel.selectedParty
        val view = viewModel.statement
        if (party != null && view != null) {
            Spacer(Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(party.name, style = MaterialTheme.typography.titleLarge)
                    if (party.phone.isNotBlank()) Text(party.phone)
                    Text(
                        if (view.balance > 0.005) {
                            if (customer) "Amount due: Rs ${view.balance}"
                            else "Amount payable: Rs ${view.balance}"
                        } else "Settled in full",
                        color = if (view.balance > 0.005) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text("Total billed: Rs ${view.totalDebit}")
                    Text("Total settled: Rs ${view.totalCredit}")
                    if (view.opening != 0.0) Text("Balance b/d: Rs ${view.opening}")
                }
            }

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { viewModel.openEntry("payment") },
                    modifier = Modifier.weight(1f),
                ) { Text(if (customer) "Payment received" else "Payment made") }
                OutlinedButton(
                    onClick = { viewModel.openEntry("bill") },
                    modifier = Modifier.weight(1f),
                ) { Text("Bill on account") }
            }

            if (viewModel.formVisible) {
                Spacer(Modifier.height(16.dp))
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text(
                            if (viewModel.entryKind == "payment") {
                                if (customer) "Payment from ${party.name}" else "Payment to ${party.name}"
                            } else "Bill on account — ${party.name}",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            if (viewModel.entryKind == "payment") {
                                "Records a credit on the khata" +
                                    if (viewModel.formAccountId != null) " and moves the money in the chosen account."
                                    else " and leaves the till untouched."
                            } else "Records a debit on the khata. No money changes hands, so no account is touched.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        TextField(
                            value = viewModel.formAmount,
                            onValueChange = { viewModel.formAmount = it },
                            label = { Text(if (viewModel.entryKind == "payment") "Amount" else "Amount billed") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                        if (viewModel.entryKind == "payment" && party.balance > 0.005) {
                            TextButton(onClick = { viewModel.formAmount = party.balance.toString() }) {
                                Text(if (customer) "Settle all Rs ${party.balance}" else "Pay all Rs ${party.balance}")
                            }
                        }
                        TextField(
                            value = viewModel.formDate,
                            onValueChange = { viewModel.formDate = it },
                            label = { Text("Date (YYYY-MM-DD)") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                        )
                        if (viewModel.entryKind == "payment") {
                            AccountDropdown(viewModel)
                        }
                        if (viewModel.entryKind == "bill" && !customer) {
                            TextField(
                                value = viewModel.formDueDate,
                                onValueChange = { viewModel.formDueDate = it },
                                label = { Text("Due date (YYYY-MM-DD, optional)") },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                            )
                        }
                        TextField(
                            value = viewModel.formNote,
                            onValueChange = { viewModel.formNote = it },
                            label = { Text("Note") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                        )
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { viewModel.submitEntry(shopId) },
                                enabled = !viewModel.busy,
                            ) {
                                Text(if (viewModel.busy) "Saving…" else "Save")
                            }
                            OutlinedButton(onClick = { viewModel.closeEntry() }) { Text("Cancel") }
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Text("Statement", style = MaterialTheme.typography.titleMedium)
            if (view.rows.isEmpty()) {
                Text("No entries", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            for (row in view.rows) {
                val entry = row.entry
                Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            "${entry.occurredAt ?: ""} · ${kindLabel(entry.kind, customer)}",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        if (entry.note.isNotBlank()) Text(entry.note)
                        Text(
                            (if (entry.direction == "debit") "Rs ${entry.amount}" else "- Rs ${entry.amount}") +
                                "  (bal Rs ${row.running})",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Text("Monthly — billed vs settled", style = MaterialTheme.typography.titleMedium)
            if (viewModel.monthly.isEmpty()) {
                Text("No monthly history", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            for (m in viewModel.monthly) {
                Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Text(monthLabel(m.month), style = MaterialTheme.typography.titleMedium)
                        Text("Billed: Rs ${m.billed} · Settled: Rs ${m.settled} · ${m.entries} entries")
                    }
                }
            }
        } else if (party == null) {
            Spacer(Modifier.height(16.dp))
            Text(
                "Pick a ${if (customer) "customer" else "vendor"} to see their khata.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(16.dp))
    }
}

private fun kindLabel(kind: String, customer: Boolean): String {
    if (kind == "payment") return if (customer) "Payment received" else "Payment made"
    return when (kind) {
        "opening" -> "Opening balance"
        "bill" -> "Bill"
        "return" -> "Return"
        "adjustment" -> "Adjustment"
        else -> kind
    }
}

/** "Sep 2026" from a "YYYY-MM" bucket; falls back to the raw value. */
private fun monthLabel(month: String): String {
    val key = monthKey(month)
    val parts = key.split("-")
    if (parts.size != 2) return month
    val year = parts[0].toIntOrNull() ?: return month
    val monthNum = parts[1].toIntOrNull() ?: return month
    if (monthNum !in 1..12) return month
    val names = listOf(
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    )
    return "${names[monthNum - 1]} $year"
}

@Composable
private fun PartyDropdown(viewModel: KhataViewModel) {
    var expanded by mutableStateOf(false)
    val selected = viewModel.selectedParty
    val label = selected?.let {
        it.name + if (it.balance > 0.005) " — Rs ${it.balance}" else ""
    } ?: "Select ${if (viewModel.partyType == "customer") "customer" else "vendor"}"
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(
            if (viewModel.partyType == "customer") "Customer" else "Vendor",
            style = MaterialTheme.typography.bodySmall,
        )
        Box(modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(label) }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                for (party in viewModel.parties) {
                    DropdownMenuItem(
                        text = {
                            Text(
                                party.name +
                                    if (party.balance > 0.005) " — Rs ${party.balance}" else "",
                            )
                        },
                        onClick = {
                            viewModel.selectParty(party.partyId)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun AccountDropdown(viewModel: KhataViewModel) {
    var expanded by mutableStateOf(false)
    val selected = viewModel.accounts.find { it.id == viewModel.formAccountId }
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text("Received into / paid from", style = MaterialTheme.typography.bodySmall)
        Box(modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(selected?.name ?: "Not booked to an account") }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                DropdownMenuItem(
                    text = { Text("Not booked to an account") },
                    onClick = {
                        viewModel.formAccountId = null
                        expanded = false
                    },
                )
                for (account in viewModel.accounts) {
                    DropdownMenuItem(
                        text = { Text(account.name) },
                        onClick = {
                            viewModel.formAccountId = account.id
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}
