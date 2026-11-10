package app.lubric.desktop.ui.expenses

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
import app.lubric.desktop.data.db.ExpenseEntity
import app.lubric.desktop.data.expenses.ExpenseRepository
import app.lubric.desktop.data.expenses.expenseDay
import app.lubric.desktop.data.pricing.round2
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import java.time.LocalDate
import kotlinx.coroutines.launch

/** Route for the coordinator's Nav.kt wiring. */
const val ROUTE_EXPENSES = "expenses"

/**
 * Expense taxonomy, verbatim from the web Expenses screen
 * (`src/modules/expenses/Expenses.tsx` CATEGORIES): `key` lands in
 * expenses.category, the sub items in expenses.subcategory. Extending
 * this list is all it takes to add a type.
 */
data class ExpenseCategory(val key: String, val subs: List<String>)

val EXPENSE_CATEGORIES = listOf(
    ExpenseCategory("Shop", listOf("Rent", "Electricity", "Water/Gas", "Internet", "Maintenance", "Upgradation", "Other")),
    ExpenseCategory("Food", listOf("Tea", "Food", "Juices", "Water", "Other")),
    ExpenseCategory("Commute", listOf("Owner", "Staff", "Delivery", "Fuel", "Other")),
    ExpenseCategory("Salary", listOf("Staff", "Owner", "Advance", "Other")),
    ExpenseCategory("Supplies", listOf("Cleaning", "Filters", "Motors", "Oil", "Tools", "Other")),
    ExpenseCategory("Other", listOf("Marketing", "Bank Charges", "Miscellaneous", "Other")),
)

fun expenseCategorySubs(category: String): List<String> =
    EXPENSE_CATEGORIES.find { it.key == category }?.subs ?: listOf("Other")

class ExpensesViewModel(
    private val expenseRepository: ExpenseRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var query by mutableStateOf("")
        private set
    var categoryFilter by mutableStateOf("")
        private set
    var fromDate by mutableStateOf("")
        private set
    var toDate by mutableStateOf("")
        private set
    var expenses by mutableStateOf<List<ExpenseEntity>>(emptyList())
        private set
    var accounts by mutableStateOf<List<AccountEntity>>(emptyList())
        private set
    /** Distinct categories found in saved expenses (merged with the taxonomy in the UI). */
    var usedCategories by mutableStateOf<List<String>>(emptyList())
        private set

    /** Category totals over the currently listed expenses, plus the period total. */
    val categoryTotals: Map<String, Double>
        get() = expenses.groupBy { it.category.ifBlank { "Other" } }
            .mapValues { (_, rows) -> round2(rows.sumOf { it.amount ?: 0.0 }) }
    val grandTotal: Double
        get() = round2(expenses.sumOf { it.amount ?: 0.0 })

    // Form state (editingId null = add). All web fields, as typed strings.
    var formVisible by mutableStateOf(false)
        private set
    var editingId by mutableStateOf<Long?>(null)
        private set
    var formCategory by mutableStateOf("Shop")
    var formSubcategory by mutableStateOf("")
    var formAmount by mutableStateOf("")
    var formDate by mutableStateOf(LocalDate.now().toString())
    var formNote by mutableStateOf("")
    var formAccountId by mutableStateOf<Long?>(null)
    /** Expense awaiting delete confirmation (inline confirm row, like the web confirm()). */
    var pendingDelete by mutableStateOf<ExpenseEntity?>(null)
        private set

    init {
        refresh()
        refreshLookups()
    }

    fun refresh() {
        viewModelScope.launch {
            expenses = try {
                expenseRepository.expenses(
                    query = query,
                    category = categoryFilter,
                    fromDate = fromDate,
                    toDate = toDate,
                )
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    fun refreshLookups() {
        viewModelScope.launch {
            try {
                accounts = expenseRepository.accounts()
                usedCategories = expenseRepository.expenseCategories()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun search(q: String) {
        query = q
        refresh()
    }

    fun setCategory(cat: String) {
        categoryFilter = cat
        refresh()
    }

    fun updateFromDate(d: String) {
        fromDate = d
        refresh()
    }

    fun updateToDate(d: String) {
        toDate = d
        refresh()
    }

    fun clearFilters() {
        query = ""
        categoryFilter = ""
        fromDate = ""
        toDate = ""
        refresh()
    }

    private fun resetForm() {
        formCategory = "Shop"
        formSubcategory = ""
        formAmount = ""
        formDate = LocalDate.now().toString()
        formNote = ""
        formAccountId = accounts.firstOrNull()?.id
    }

    fun openAdd() {
        editingId = null
        resetForm()
        error = null
        formVisible = true
    }

    fun openEdit(expense: ExpenseEntity) {
        editingId = expense.id
        formCategory = expense.category.ifBlank { "Shop" }
        formSubcategory = expense.subcategory
        formAmount = (expense.amount ?: 0.0).toString()
        formDate = expense.date ?: expenseDay(expense).ifBlank { LocalDate.now().toString() }
        formNote = expense.note
        formAccountId = expense.accountId?.toLong() ?: accounts.firstOrNull()?.id
        error = null
        formVisible = true
    }

    fun closeForm() {
        formVisible = false
        editingId = null
    }

    fun selectCategory(category: String) {
        formCategory = category
        formSubcategory = ""
    }

    fun toggleSubcategory(sub: String) {
        formSubcategory = if (formSubcategory == sub) "" else sub
    }

    fun save(shopId: Int) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                val amount = formAmount.toDoubleOrNull() ?: 0.0
                expenseRepository.saveExpense(
                    form = ExpenseRepository.ExpenseForm(
                        category = formCategory,
                        subcategory = formSubcategory,
                        amount = amount,
                        accountId = formAccountId ?: 0L,
                        date = formDate,
                        note = formNote,
                    ),
                    shopId = shopId,
                    existingId = editingId,
                )
                formVisible = false
                editingId = null
                refresh()
                refreshLookups()
            } catch (e: Exception) {
                error = e.message ?: "Could not save expense"
            } finally {
                busy = false
            }
        }
    }

    fun requestDelete(expense: ExpenseEntity) {
        pendingDelete = expense
    }

    fun cancelDelete() {
        pendingDelete = null
    }

    fun confirmDelete() {
        val expense = pendingDelete ?: return
        viewModelScope.launch {
            try {
                expenseRepository.deleteExpense(expense.id)
                pendingDelete = null
                refresh()
            } catch (e: Exception) {
                error = e.message
                pendingDelete = null
            }
        }
    }
}

@Composable
fun ExpensesScreen(
    viewModel: ExpensesViewModel,
    shopId: Int,
    onBack: () -> Unit,
) {
    LubricScreen(title = "Expenses", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        TextField(
            value = viewModel.query,
            onValueChange = { viewModel.search(it) },
            label = { Text("Search by note or category") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextField(
                value = viewModel.fromDate,
                onValueChange = { viewModel.updateFromDate(it) },
                label = { Text("From (YYYY-MM-DD)") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            TextField(
                value = viewModel.toDate,
                onValueChange = { viewModel.updateToDate(it) },
                label = { Text("To (YYYY-MM-DD)") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
        }
        Spacer(Modifier.height(8.dp))
        CategoryFilterRow(viewModel)
        if (viewModel.query.isNotBlank() || viewModel.categoryFilter.isNotBlank() ||
            viewModel.fromDate.isNotBlank() || viewModel.toDate.isNotBlank()
        ) {
            TextButton(onClick = { viewModel.clearFilters() }) { Text("Clear filters") }
        }
        Button(
            onClick = { viewModel.openAdd() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("+ Add Expense") }
        ErrorText(viewModel.error)

        Spacer(Modifier.height(12.dp))
        // Category totals, mirroring the web's summary cards + period total.
        for ((category, total) in viewModel.categoryTotals) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(category)
                Text("Rs $total", color = MaterialTheme.colorScheme.error)
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("Period total", style = MaterialTheme.typography.titleMedium)
            Text("Rs ${viewModel.grandTotal}", style = MaterialTheme.typography.titleMedium)
        }
        Text(
            "${viewModel.expenses.size} entries",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (viewModel.formVisible) {
            Spacer(Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        if (viewModel.editingId != null) "Edit Expense" else "Add Expense",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("Where did the money go?", style = MaterialTheme.typography.titleSmall)
                    CategoryTileRow(viewModel)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "${viewModel.formCategory} — what kind?",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        for (sub in expenseCategorySubs(viewModel.formCategory)) {
                            val on = viewModel.formSubcategory == sub
                            OutlinedButton(onClick = { viewModel.toggleSubcategory(sub) }) {
                                Text(if (on) "✓ $sub" else sub)
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    TextField(
                        value = viewModel.formAmount,
                        onValueChange = { viewModel.formAmount = it },
                        label = { Text("Amount *") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                    TextField(
                        value = viewModel.formDate,
                        onValueChange = { viewModel.formDate = it },
                        label = { Text("Date (YYYY-MM-DD)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    AccountDropdown(viewModel)
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
                            onClick = { viewModel.save(shopId) },
                            enabled = !viewModel.busy,
                        ) {
                            Text(if (viewModel.busy) "Saving…" else "Save")
                        }
                        OutlinedButton(onClick = { viewModel.closeForm() }) { Text("Cancel") }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        if (viewModel.expenses.isEmpty()) {
            Text(
                "No expenses — add your first expense: rent, tea, commute, all of it",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val accountNames = viewModel.accounts.associate { it.id to it.name }
        for (expense in viewModel.expenses) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            (expense.subcategory.ifBlank { expense.category }),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            "Rs ${expense.amount ?: 0.0}",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    Text(
                        "${expense.category}" +
                            if (expense.note.isNotBlank()) " · ${expense.note}" else "",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "${expenseDay(expense)} · " +
                            (expense.accountId?.let { accountNames[it.toLong()] } ?: "Cash"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (viewModel.pendingDelete?.id == expense.id) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Delete this expense? The amount goes back to the account.",
                            color = MaterialTheme.colorScheme.error,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = { viewModel.confirmDelete() }) { Text("Delete") }
                            TextButton(onClick = { viewModel.cancelDelete() }) { Text("Keep it") }
                        }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = { viewModel.openEdit(expense) }) { Text("Edit") }
                            TextButton(onClick = { viewModel.requestDelete(expense) }) { Text("Delete") }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun CategoryFilterRow(viewModel: ExpensesViewModel) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (category in EXPENSE_CATEGORIES) {
            val active = viewModel.categoryFilter == category.key
            OutlinedButton(
                onClick = { viewModel.setCategory(if (active) "" else category.key) },
            ) {
                Text(category.key)
            }
        }
    }
    // Categories used in saved expenses but outside the fixed taxonomy.
    val extra = viewModel.usedCategories.filter { used ->
        EXPENSE_CATEGORIES.none { it.key == used }
    }
    if (extra.isNotEmpty()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (category in extra) {
                val active = viewModel.categoryFilter == category
                OutlinedButton(
                    onClick = { viewModel.setCategory(if (active) "" else category) },
                ) {
                    Text(category)
                }
            }
        }
    }
}

@Composable
private fun CategoryTileRow(viewModel: ExpensesViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (row in EXPENSE_CATEGORIES.chunked(3)) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (category in row) {
                    val active = viewModel.formCategory == category.key
                    if (active) {
                        Button(
                            onClick = { viewModel.selectCategory(category.key) },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(category.key)
                        }
                    } else {
                        OutlinedButton(
                            onClick = { viewModel.selectCategory(category.key) },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(category.key)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AccountDropdown(viewModel: ExpensesViewModel) {
    var expanded by mutableStateOf(false)
    val selectedName = viewModel.accounts
        .find { it.id == viewModel.formAccountId }?.name ?: "—"
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text("Paid from", style = MaterialTheme.typography.bodySmall)
        if (viewModel.accounts.isEmpty()) {
            Text(
                "No active accounts yet — add one from Accounts first",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Box(modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(selectedName)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
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
