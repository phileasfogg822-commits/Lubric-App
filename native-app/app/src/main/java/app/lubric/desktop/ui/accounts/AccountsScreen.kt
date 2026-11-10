package app.lubric.desktop.ui.accounts

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.accounts.AccountRepository
import app.lubric.desktop.data.db.AccountEntity
import app.lubric.desktop.data.db.AccountTransactionEntity
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

/** Routes for the coordinator's Nav.kt wiring. */
const val ROUTE_ACCOUNTS = "accounts"
const val ROUTE_ACCOUNT_DETAIL = "account_detail/{accountId}"

fun accountDetailRoute(accountId: Long) = "account_detail/$accountId"

/**
 * Account types the form offers. Migration 027's CHECK allows only
 * cash/bank/other — the web form's extra 'credit_card' option is NOT
 * offered here (the database would refuse it), and 'wallet' is rejected
 * by [AccountRepository.saveAccount].
 */
private val ACCOUNT_TYPES = listOf("cash", "bank", "other")

class AccountsViewModel(
    private val accountRepository: AccountRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    var accounts by mutableStateOf<List<AccountEntity>>(emptyList())
        private set

    // Form state (editingId null = add). The web form has name + type only.
    var formVisible by mutableStateOf(false)
        private set
    var editingId by mutableStateOf<Long?>(null)
        private set
    var formName by mutableStateOf("")
    var formType by mutableStateOf("cash")

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            accounts = try {
                accountRepository.accounts()
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }

    fun openAdd() {
        editingId = null
        formName = ""
        formType = "cash"
        error = null
        formVisible = true
    }

    fun openEdit(account: AccountEntity) {
        editingId = account.id
        formName = account.name
        formType = account.type.ifBlank { "cash" }
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
                accountRepository.saveAccount(
                    form = AccountRepository.AccountForm(name = formName, type = formType),
                    shopId = shopId,
                    existingId = editingId,
                )
                formVisible = false
                editingId = null
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not save account"
            } finally {
                busy = false
            }
        }
    }

    fun toggleActive(account: AccountEntity) {
        viewModelScope.launch {
            try {
                accountRepository.setAccountActive(account.id, !account.active)
                refresh()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }
}

class AccountDetailViewModel(
    private val accountRepository: AccountRepository,
) : ViewModel() {

    var error by mutableStateOf<String?>(null)
        private set
    var detail by mutableStateOf<AccountRepository.AccountDetail?>(null)
        private set

    fun refresh(accountId: Long) {
        viewModelScope.launch {
            detail = try {
                accountRepository.accountDetail(accountId)
            } catch (e: Exception) {
                error = e.message
                null
            }
        }
    }
}

@Composable
fun AccountsScreen(
    viewModel: AccountsViewModel,
    shopId: Int,
    onAccountClick: (Long) -> Unit,
    onBack: () -> Unit,
) {
    LubricScreen(title = "Accounts", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = { viewModel.openAdd() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("+ Add Account") }
        ErrorText(viewModel.error)

        if (viewModel.formVisible) {
            Spacer(Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        if (viewModel.editingId != null) "Edit Account" else "Add Account",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    TextField(
                        value = viewModel.formName,
                        onValueChange = { viewModel.formName = it },
                        label = { Text("Account Name *") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    TypeDropdown(
                        label = "Type",
                        selected = viewModel.formType,
                        onSelect = { viewModel.formType = it },
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
        if (viewModel.accounts.isEmpty()) {
            Text("No accounts", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (account in viewModel.accounts) {
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        account.name + if (account.active) "" else " (inactive)",
                        style = MaterialTheme.typography.titleMedium,
                        color = if (account.active) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        account.type,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Rs ${account.balance ?: 0.0}",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { onAccountClick(account.id) }) { Text("History") }
                        TextButton(onClick = { viewModel.openEdit(account) }) { Text("Edit") }
                        TextButton(onClick = { viewModel.toggleActive(account) }) {
                            Text(if (account.active) "Deactivate" else "Activate")
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
fun AccountDetailScreen(
    viewModel: AccountDetailViewModel,
    accountId: Long,
    onBack: () -> Unit,
) {
    LaunchedEffect(accountId) { viewModel.refresh(accountId) }
    val detail = viewModel.detail
    LubricScreen(title = detail?.account?.name ?: "Account", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        ErrorText(viewModel.error)
        if (detail == null) {
            Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Text("Type: ${detail.account.type}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                "Current Balance: Rs ${detail.account.balance ?: 0.0}",
                style = MaterialTheme.typography.titleLarge,
            )
            Spacer(Modifier.height(16.dp))
            Text("History", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            if (detail.transactions.isEmpty()) {
                Text("No transactions yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            for (tx in detail.transactions) {
                TransactionRow(tx)
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun TransactionRow(tx: AccountTransactionEntity) {
    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(tx.reference.ifBlank { "—" })
                Text(
                    (tx.createdAt ?: "").replace("T", " ").take(19),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                (if (tx.type == "in") "+" else "-") + "Rs ${tx.amount ?: 0.0}",
                color = if (tx.type == "in") MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun TypeDropdown(label: String, selected: String, onSelect: (String) -> Unit) {
    var expanded by mutableStateOf(false)
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall)
        Box(modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(selected)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                for (type in ACCOUNT_TYPES) {
                    DropdownMenuItem(
                        text = { Text(type) },
                        onClick = {
                            onSelect(type)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}
