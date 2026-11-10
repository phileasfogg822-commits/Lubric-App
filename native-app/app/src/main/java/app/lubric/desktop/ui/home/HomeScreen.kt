package app.lubric.desktop.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.auth.AuthRepository
import app.lubric.desktop.data.auth.AuthSession
import app.lubric.desktop.ui.accounts.ROUTE_ACCOUNTS
import app.lubric.desktop.ui.branding.WHITELABEL_ROUTE
import app.lubric.desktop.ui.expenses.ROUTE_EXPENSES
import app.lubric.desktop.ui.field.FIELD_ROUTE
import app.lubric.desktop.ui.inspections.INSPECTIONS_ROUTE
import app.lubric.desktop.ui.khata.KHATA_ROUTE
import app.lubric.desktop.ui.purchases.PURCHASES_ROUTE
import app.lubric.desktop.ui.reminders.REMINDERS_ROUTE
import app.lubric.desktop.ui.reports.PROFIT_ROUTE
import app.lubric.desktop.ui.reports.REPORTS_ROUTE
import app.lubric.desktop.ui.shop.SHOP_ROUTE
import app.lubric.desktop.ui.team.TEAM_ROUTE
import app.lubric.desktop.ui.transactions.TRANSACTIONS_ROUTE
import app.lubric.desktop.ui.vendors.VENDORS_ROUTE
import app.lubric.desktop.data.dashboard.DashboardRepository
import app.lubric.desktop.data.sync.SyncRepository
import app.lubric.desktop.data.sync.SyncState
import app.lubric.desktop.data.sync.SyncStatus
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.syncStatusLabel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlin.math.floor

/**
 * Home is now the real dashboard: today's sales, low stock, pending
 * reminders, account balances — all from local Room — plus the connection
 * card, the outlet picker, and navigation to the core screens.
 *
 * Pull-to-refresh triggers a sync round (push then pull) and reloads the
 * dashboard. The "Sync now" button does the same for devices where the
 * swipe gesture is awkward.
 *
 * On first appearance the ViewModel also runs one sync when the device is
 * paired (sync-on-app-open, matching the web app) and loads the dashboard.
 */
class HomeViewModel(
    private val syncRepository: SyncRepository,
    private val authRepository: AuthRepository,
    private val dashboardRepository: DashboardRepository,
) : ViewModel() {

    val session: StateFlow<AuthSession?> = authRepository.session
    val syncState: StateFlow<SyncState> = syncRepository.state

    /** Null while loading; an empty map after a failed load (rows then read 0). */
    var counts by mutableStateOf<Map<String, Int>?>(null)
        private set

    var dashboard by mutableStateOf<DashboardRepository.DashboardData?>(null)
        private set

    var shopMenuOpen by mutableStateOf(false)
        private set

    var actionError by mutableStateOf<String?>(null)
        private set

    init {
        refreshCounts()
        refreshDashboard()
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

    fun refreshDashboard() {
        viewModelScope.launch {
            dashboard = try {
                dashboardRepository.load()
            } catch (e: Exception) {
                actionError = "Could not load dashboard: ${e.message}"
                null
            }
        }
    }

    fun syncNow() {
        if (syncState.value.status == SyncStatus.SYNCING) return
        actionError = null
        viewModelScope.launch {
            syncRepository.syncNow()
                .onSuccess { refreshCounts(); refreshDashboard() }
                .onFailure { actionError = it.message ?: "Sync failed. Try again." }
        }
    }

    /** Suspending sync used by pull-to-refresh; always returns normally. */
    suspend fun syncNowAwait() {
        if (syncState.value.status == SyncStatus.SYNCING) return
        actionError = null
        syncRepository.syncNow()
            .onSuccess { refreshCounts(); refreshDashboard() }
            .onFailure { actionError = it.message ?: "Sync failed. Try again." }
    }

    fun openShopMenu() {
        shopMenuOpen = true
    }

    fun closeShopMenu() {
        shopMenuOpen = false
    }

    fun switchShop(shopId: Int) {
        shopMenuOpen = false
        viewModelScope.launch {
            authRepository.switchShop(shopId)
                .onFailure { actionError = it.message ?: "Could not switch outlet." }
        }
    }

    fun signOut() {
        viewModelScope.launch { authRepository.logout() }
    }
}

/** "Rs 1,500" for whole rupees, "Rs 1,500.50" when there are paisa. */
fun money(n: Double): String =
    if (n == floor(n)) "Rs ${"%,.0f".format(n)}" else "Rs ${"%,.2f".format(n)}"

/** Phase 3 home menu: label + route for every screen beyond the main four. */
private val MORE_MENU: List<Pair<String, String>> = listOf(
    "Vendors" to VENDORS_ROUTE,
    "Khata" to KHATA_ROUTE,
    "Accounts" to ROUTE_ACCOUNTS,
    "Expenses" to ROUTE_EXPENSES,
    "Purchases" to PURCHASES_ROUTE,
    "Inspections" to INSPECTIONS_ROUTE,
    "Reminders" to REMINDERS_ROUTE,
    "Transactions" to TRANSACTIONS_ROUTE,
    "Reports" to REPORTS_ROUTE,
    "Profit & Loss" to PROFIT_ROUTE,
    "Field Activity" to FIELD_ROUTE,
    "Team & Access" to TEAM_ROUTE,
    "Shop Settings" to SHOP_ROUTE,
    "White Label" to WHITELABEL_ROUTE,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onOpenSync: () -> Unit,
    onOpenSale: () -> Unit,
    onOpenCustomers: () -> Unit,
    onOpenProducts: () -> Unit,
    onOpenScreen: (String) -> Unit,
) {
    val session by viewModel.session.collectAsState()
    val syncState by viewModel.syncState.collectAsState()
    val dashboard = viewModel.dashboard

    // Pull-to-refresh, hand-rolled: material3 1.1.2 (this project's BOM)
    // has no pull-to-refresh API (that arrived in 1.3), so a small
    // NestedScrollConnection absorbs a downward drag at the top of the
    // list and triggers a sync round on release past the threshold.
    val scrollState = rememberScrollState()
    val density = LocalDensity.current
    val thresholdPx = with(density) { 80.dp.toPx() }
    val maxOffsetPx = with(density) { 140.dp.toPx() }
    var dragOffsetPx by remember { mutableStateOf(0f) }
    var refreshing by remember { mutableStateOf(false) }
    val pullConnection = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (refreshing) return Offset.Zero
                if (available.y > 0 && scrollState.value == 0) {
                    val newOffset = (dragOffsetPx + available.y).coerceAtMost(maxOffsetPx)
                    val consumed = newOffset - dragOffsetPx
                    dragOffsetPx = newOffset
                    return Offset(0f, consumed)
                }
                return Offset.Zero
            }

            override suspend fun onPreFling(available: Velocity): Velocity {
                if (dragOffsetPx >= thresholdPx && !refreshing) {
                    refreshing = true
                    dragOffsetPx = 0f
                    viewModel.syncNowAwait()
                    refreshing = false
                } else {
                    dragOffsetPx = 0f
                }
                return Velocity.Zero
            }
        }
    }

    val currentSession = session
    val shopName = currentSession?.shops?.firstOrNull { it.id == currentSession.shopId }?.name
        ?: currentSession?.let { "Shop ${it.shopId}" }
        ?: "Lubric POS"
    val shops = currentSession?.shops ?: emptyList()

    Scaffold(
        topBar = { TopAppBar(title = { Text(shopName) }) },
        modifier = Modifier.nestedScroll(pullConnection),
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState)
                    .padding(horizontal = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth()) {
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = currentSession?.let { "Signed in as ${it.name} (${it.email})" }
                            ?: "Loading…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(16.dp))

                    // -- Outlet picker (only when the user has > 1 outlet) --
                    if (shops.size > 1) {
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(16.dp)) {
                                Text("Outlet", style = MaterialTheme.typography.titleMedium)
                                Spacer(Modifier.height(8.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(shopName)
                                    Box {
                                        OutlinedButton(onClick = { viewModel.openShopMenu() }) {
                                            Text("Switch outlet")
                                        }
                                        DropdownMenu(
                                            expanded = viewModel.shopMenuOpen,
                                            onDismissRequest = { viewModel.closeShopMenu() },
                                        ) {
                                            for (shop in shops) {
                                                DropdownMenuItem(
                                                    text = {
                                                        Text(
                                                            (shop.name ?: "Shop ${shop.id}") +
                                                                if (shop.id == currentSession?.shopId) " (current)" else "",
                                                        )
                                                    },
                                                    onClick = { viewModel.switchShop(shop.id) },
                                                )
                                            }
                                        }
                                    }
                                }
                                Text(
                                    "Synced data stays with the shop this device was paired to.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                    }

                    // -- Dashboard --
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Text("Today", style = MaterialTheme.typography.titleMedium)
                            Spacer(Modifier.height(8.dp))
                            if (dashboard == null) {
                                Text("Loading…")
                            } else {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text("Sales today")
                                    Text(money(dashboard.todayTotal) + " (${dashboard.todayCount})")
                                }
                                Spacer(Modifier.height(4.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text("Pending reminders")
                                    Text(dashboard.pendingReminders.toString())
                                }
                                Spacer(Modifier.height(12.dp))
                                Text("Low stock", style = MaterialTheme.typography.titleSmall)
                                if (dashboard.lowStock.isEmpty()) {
                                    Text("Nothing low on stock.")
                                } else {
                                    for (p in dashboard.lowStock) {
                                        Row(
                                            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                        ) {
                                            Text(p.name)
                                            Text(
                                                "${p.stockQty ?: 0.0} left",
                                                color = MaterialTheme.colorScheme.error,
                                            )
                                        }
                                    }
                                }
                                Spacer(Modifier.height(12.dp))
                                Text("Accounts", style = MaterialTheme.typography.titleSmall)
                                if (dashboard.accounts.isEmpty()) {
                                    Text("No accounts yet.")
                                } else {
                                    for (a in dashboard.accounts) {
                                        Row(
                                            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                        ) {
                                            Text(a.name)
                                            Text(money(a.balance ?: 0.0))
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = onOpenSale,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("New Sale") }
                    Spacer(Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(
                            onClick = onOpenCustomers,
                            modifier = Modifier.weight(1f).padding(end = 4.dp),
                        ) { Text("Customers") }
                        OutlinedButton(
                            onClick = onOpenProducts,
                            modifier = Modifier.weight(1f).padding(start = 4.dp),
                        ) { Text("Products") }
                    }

                    // -- More: every other screen, two buttons per row so
                    // the menu fits a phone and still reads on a tablet.
                    Spacer(Modifier.height(16.dp))
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Text("More", style = MaterialTheme.typography.titleMedium)
                            Spacer(Modifier.height(8.dp))
                            for (row in MORE_MENU.chunked(2)) {
                                Row(modifier = Modifier.fillMaxWidth()) {
                                    for ((index, entry) in row.withIndex()) {
                                        OutlinedButton(
                                            onClick = { onOpenScreen(entry.second) },
                                            modifier = Modifier.weight(1f)
                                                .padding(
                                                    end = if (index == 0 && row.size > 1) 4.dp else 0.dp,
                                                    start = if (index == 1) 4.dp else 0.dp,
                                                ),
                                        ) { Text(entry.first) }
                                    }
                                    // A lone button in the last row still
                                    // takes only half the width, like the
                                    // Customers/Products row above.
                                    if (row.size == 1) {
                                        Spacer(Modifier.weight(1f).padding(start = 4.dp))
                                    }
                                }
                                Spacer(Modifier.height(8.dp))
                            }
                        }
                    }

                    Spacer(Modifier.height(16.dp))
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Text("Connection", style = MaterialTheme.typography.titleMedium)
                            Spacer(Modifier.height(8.dp))
                            Text("Status: ${syncStatusLabel(syncState.status)}")
                            if (syncState.status == SyncStatus.ERROR && syncState.lastError.isNotBlank()) {
                                Text(
                                    "Error: ${syncState.lastError}",
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                            Text("Last sync: ${syncState.lastSyncAt ?: "Never"}")
                            Text(
                                "Last round: ${syncState.pulled} pulled • ${syncState.pushed} pushed • " +
                                    "${syncState.rejected} rejected",
                            )
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

                    Spacer(Modifier.height(16.dp))
                    OutlinedButton(
                        onClick = onOpenSync,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("View sync status")
                    }
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(
                        onClick = { viewModel.signOut() },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Sign out")
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }
            // Pull-to-refresh indicator: appears while dragging down at
            // the top, spins while the sync round runs.
            if (dragOffsetPx > 0f || refreshing) {
                Row(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp,
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(
                        if (refreshing) "Syncing…" else "Release to sync",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}
