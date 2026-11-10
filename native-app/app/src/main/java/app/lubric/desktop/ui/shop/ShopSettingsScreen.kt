package app.lubric.desktop.ui.shop

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.BuildConfig
import app.lubric.desktop.data.db.ShopEntity
import app.lubric.desktop.data.shop.ShopRepository
import app.lubric.desktop.data.sync.SyncRepository
import app.lubric.desktop.data.sync.SyncState
import app.lubric.desktop.data.sync.SyncStatus
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import app.lubric.desktop.ui.common.syncStatusLabel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Route string for the Shop Settings screen (coordinator wires Nav.kt). */
const val SHOP_ROUTE = "shop"

/**
 * Shop Settings view model: the shop row + settings (read-only) and the
 * device/sync status with the one write on this screen, Sync now, which
 * delegates to the existing [SyncRepository] — sync itself is not
 * reimplemented here.
 *
 * The shop id comes from the call site (the active outlet); [refresh] takes
 * it because the screen, not the view model, knows which outlet is active.
 */
class ShopSettingsViewModel(
    private val shopRepository: ShopRepository,
    private val syncRepository: SyncRepository,
) : ViewModel() {

    var shop by mutableStateOf<ShopEntity?>(null)
        private set
    var settings by mutableStateOf<Map<String, String?>>(emptyMap())
        private set
    var error by mutableStateOf<String?>(null)
        private set

    val syncState: StateFlow<SyncState> = syncRepository.state

    // Plain Flow (DataStore), not a StateFlow — the screen collects it
    // with an initial null, as SyncStatusScreen does.
    val deviceToken: Flow<String?> = syncRepository.deviceToken

    var actionError by mutableStateOf<String?>(null)
        private set

    fun refresh(shopId: Int) {
        viewModelScope.launch {
            try {
                shop = shopRepository.shopDetails(shopId)
                settings = shopRepository.settings()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    fun syncNow() {
        if (syncState.value.status == SyncStatus.SYNCING) return
        actionError = null
        viewModelScope.launch {
            syncRepository.syncNow()
                .onFailure { actionError = it.message ?: "Sync failed. Try again." }
        }
    }
}

/**
 * Shop Settings, read-only in this phase.
 *
 * Mirrors `src/modules/shop/Shop.tsx`: Business Info (name, address, phone,
 * currency — the values bills read straight from the shops table), POS
 * Configuration (used-oil drum capacity, wholesale mode, manual price
 * entry), the settings table as a key/value list, and Cloud & Sync (cloud
 * URL, paired-device status, last sync, Sync now). The web screen's edit
 * form, Save Settings, cloud-URL editing, pairing-code entry and the
 * Phones & Devices add/revoke/fetch actions are NOT reproduced here — the
 * local `devices` table is not synced (§4.1), so this device cannot list
 * the shop's other phones; it shows its own pairing + sync status only.
 */
@Composable
fun ShopSettingsScreen(
    viewModel: ShopSettingsViewModel,
    shopId: Int,
    onBack: () -> Unit,
) {
    val syncState by viewModel.syncState.collectAsState()
    val deviceToken by viewModel.deviceToken.collectAsState(initial = null)

    LaunchedEffect(shopId) { viewModel.refresh(shopId) }

    LubricScreen(title = "Shop Settings", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        ErrorText(viewModel.error)

        // -- Business info -------------------------------------------------
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Business Info", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                val shop = viewModel.shop
                if (shop == null) {
                    Text(
                        "No shop stored on this device yet.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text("Shop name: ${shop.name}")
                    Text("Address: ${shop.address.ifBlank { "—" }}")
                    Text("Phone: ${shop.phone.ifBlank { "—" }}")
                    Text("Currency: ${shop.currency}")
                }
            }
        }
        Spacer(Modifier.height(12.dp))

        // -- POS configuration (shop-row columns) --------------------------
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("POS Configuration", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                val shop = viewModel.shop
                if (shop == null) {
                    Text(
                        "No shop stored on this device yet.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text("Used oil drum capacity: ${shop.usedOilDrumCapacity} L")
                    Text("Wholesale mode: ${shop.wholesaleMode}")
                    Text(
                        "Manual price entry: " +
                            if (shop.manualPriceAllowed) "Allowed" else "Not allowed",
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))

        // -- Phones & Devices: this device's pairing + sync status --------
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Phones & Devices", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text("This device: ${if (deviceToken != null) "Paired" else "Not paired"}")
                Text("Sync status: ${syncStatusLabel(syncState.status)}")
                Text("Last sync: ${syncState.lastSyncAt ?: "Never"}")
                Text("Last round pushed: ${syncState.pushed}")
                Text("Last round pulled: ${syncState.pulled}")
                Text("Last round rejected: ${syncState.rejected}")
                if (syncState.lastError.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Last error: ${syncState.lastError}",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { viewModel.syncNow() },
                    enabled = syncState.status != SyncStatus.SYNCING,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (syncState.status == SyncStatus.SYNCING) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Sync now")
                    }
                }
                ErrorText(viewModel.actionError)
            }
        }
        Spacer(Modifier.height(12.dp))

        // -- Cloud & Sync ---------------------------------------------------
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Cloud & Sync", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text("Cloud server URL: ${BuildConfig.HUB_URL}")
                Text(
                    "The cloud URL is baked into this install; " +
                        "it cannot be changed from this screen.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        Spacer(Modifier.height(12.dp))

        // -- Settings rows --------------------------------------------------
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Settings", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                if (viewModel.settings.isEmpty()) {
                    Text(
                        "No settings stored on this device.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    for ((key, value) in viewModel.settings) {
                        Text("$key: ${value ?: "—"}")
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
