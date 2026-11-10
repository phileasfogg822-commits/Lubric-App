package app.lubric.desktop.ui.sync

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import app.lubric.desktop.data.sync.SyncRepository
import app.lubric.desktop.data.sync.SyncState
import app.lubric.desktop.data.sync.SyncStatus
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import app.lubric.desktop.ui.common.syncStatusLabel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Detail view over the same sync state the home card summarises. */
class SyncStatusViewModel(private val syncRepository: SyncRepository) : ViewModel() {

    val syncState: StateFlow<SyncState> = syncRepository.state

    // Plain Flow (DataStore), not a StateFlow — the screen collects it
    // with an initial null.
    val deviceToken: Flow<String?> = syncRepository.deviceToken

    var actionError by mutableStateOf<String?>(null)
        private set

    fun syncNow() {
        if (syncState.value.status == SyncStatus.SYNCING) return
        actionError = null
        viewModelScope.launch {
            syncRepository.syncNow()
                .onFailure { actionError = it.message ?: "Sync failed. Try again." }
        }
    }
}

@Composable
fun SyncStatusScreen(viewModel: SyncStatusViewModel, onBack: () -> Unit) {
    val syncState by viewModel.syncState.collectAsState()
    val deviceToken by viewModel.deviceToken.collectAsState(initial = null)

    LubricScreen(title = "Sync status", onBack = onBack) {
        Spacer(Modifier.height(16.dp))
        Text(
            "Sync sends changes made on this device to the shop server and " +
                "downloads the latest products, customers and orders, so this " +
                "device stays up to date.",
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(Modifier.height(16.dp))
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Status: ${syncStatusLabel(syncState.status)}")
                Spacer(Modifier.height(8.dp))
                Text("Device: ${if (deviceToken != null) "Paired" else "Not paired"}")
                Text("Last sync: ${syncState.lastSyncAt ?: "Never"}")
                Text("Last round pushed: ${syncState.pushed}")
                Text("Last round pulled: ${syncState.pulled}")
                Text("Last round rejected: ${syncState.rejected}")
                if (syncState.lastError.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Last error: ${syncState.lastError}",
                        color = MaterialTheme.colorScheme.error
                    )
                }
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
    }
}
