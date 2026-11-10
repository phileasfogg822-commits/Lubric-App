package app.lubric.desktop.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.auth.AuthRepository
import app.lubric.desktop.data.auth.AuthSession
import app.lubric.desktop.data.sync.SyncRepository
import app.lubric.desktop.data.sync.SyncState
import app.lubric.desktop.data.sync.SyncStatus
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import app.lubric.desktop.ui.common.syncStatusLabel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Home: who is signed in, the connection state, what is on this device, and
 * sign out. Signing out only calls [AuthRepository.logout]; the NavHost
 * observes the session flow and navigates back to login.
 *
 * On first appearance the ViewModel also runs one sync when the device is
 * paired (sync-on-app-open, matching the web app) and loads the local row
 * counts.
 */
class HomeViewModel(
    private val syncRepository: SyncRepository,
    private val authRepository: AuthRepository
) : ViewModel() {

    val session: StateFlow<AuthSession?> = authRepository.session
    val syncState: StateFlow<SyncState> = syncRepository.state

    /** Null while loading; an empty map after a failed load (rows then read 0). */
    var counts by mutableStateOf<Map<String, Int>?>(null)
        private set

    var actionError by mutableStateOf<String?>(null)
        private set

    init {
        refreshCounts()
        // Sync-on-open when paired. deviceToken is a cold DataStore flow
        // (not a StateFlow), so read its first value in a coroutine rather
        // than a synchronous .value check.
        viewModelScope.launch {
            if (syncRepository.deviceToken.first() != null) {
                syncNow()
            }
        }
    }

    fun refreshCounts() {
        viewModelScope.launch {
            counts = try {
                syncRepository.tableCounts()
            } catch (e: Exception) {
                emptyMap()
            }
        }
    }

    fun syncNow() {
        if (syncState.value.status == SyncStatus.SYNCING) return
        actionError = null
        viewModelScope.launch {
            syncRepository.syncNow()
                .onSuccess { refreshCounts() }
                .onFailure { actionError = it.message ?: "Sync failed. Try again." }
        }
    }

    fun signOut() {
        viewModelScope.launch { authRepository.logout() }
    }
}

/**
 * Table keys shown on home. Assumption: [SyncRepository.tableCounts] keys
 * its map by table name (products, customers, …); a key the map does not
 * contain is shown as 0 rather than crashing (e.g. categories/brands, which
 * the live server does not serve yet — see survey §8.1).
 */
private val COUNT_ROWS = listOf(
    "products" to "Products",
    "customers" to "Customers",
    "orders" to "Orders",
    "services" to "Services",
    "vendors" to "Vendors",
    "accounts" to "Accounts"
)

@Composable
fun HomeScreen(viewModel: HomeViewModel, onOpenSync: () -> Unit) {
    val session by viewModel.session.collectAsState()
    val syncState by viewModel.syncState.collectAsState()
    val counts = viewModel.counts

    val currentSession = session
    val shopName = currentSession?.shops?.firstOrNull { it.id == currentSession.shopId }?.name
        ?: currentSession?.let { "Shop ${it.shopId}" }
        ?: "Lubric POS"

    LubricScreen(title = shopName) {
        Spacer(Modifier.height(16.dp))
        Text(
            text = currentSession?.let { "Signed in as ${it.name} (${it.email})" }
                ?: "Loading…",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Connection", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text("Status: ${syncStatusLabel(syncState.status)}")
                if (syncState.status == SyncStatus.ERROR && syncState.lastError.isNotBlank()) {
                    Text(
                        "Error: ${syncState.lastError}",
                        color = MaterialTheme.colorScheme.error
                    )
                }
                Text("Last sync: ${syncState.lastSyncAt ?: "Never"}")
                Text(
                    "Last round: ${syncState.pulled} pulled • ${syncState.pushed} pushed • " +
                        "${syncState.rejected} rejected"
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { viewModel.syncNow() },
                    enabled = syncState.status != SyncStatus.SYNCING,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (syncState.status == SyncStatus.SYNCING) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Sync now")
                    }
                }
                ErrorText(viewModel.actionError)
            }
        }

        Spacer(Modifier.height(16.dp))
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("On this device", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                for ((key, label) in COUNT_ROWS) {
                    val valueText = when {
                        counts == null -> "—"
                        else -> (counts[key] ?: 0).toString()
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(label)
                        Text(valueText)
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        OutlinedButton(
            onClick = onOpenSync,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("View sync status")
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
            onClick = { viewModel.signOut() },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Sign out")
        }
        Spacer(Modifier.height(16.dp))
    }
}
