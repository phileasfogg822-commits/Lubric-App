package app.lubric.desktop.ui.branding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.branding.BrandingRepository
import app.lubric.desktop.data.branding.BrandingState
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

/** Route string for the White Label screen (coordinator wires Nav.kt). */
const val WHITELABEL_ROUTE = "whitelabel"

/** Parse a "#RRGGBB" colour; null when the text is not a 6-digit hex colour. */
fun colorFromHex(hex: String): Color? {
    val clean = hex.trim().removePrefix("#")
    if (clean.length != 6) return null
    val value = clean.toLongOrNull(16) ?: return null
    return Color(0xFF000000L or value)
}

class WhiteLabelViewModel(
    private val brandingRepository: BrandingRepository,
) : ViewModel() {

    var state by mutableStateOf<BrandingState?>(null)
        private set
    var loading by mutableStateOf(false)
        private set

    init {
        refresh()
    }

    fun refresh() {
        if (loading) return
        loading = true
        viewModelScope.launch {
            try {
                state = brandingRepository.loadBranding()
            } finally {
                loading = false
            }
        }
    }
}

/**
 * White Label, read-only in this phase.
 *
 * Mirrors `src/modules/settings/WhiteLabel.tsx` (Branding: app name +
 * primary colour; Included modules; Feature flags). The web screen's save
 * buttons, module checkboxes and flag toggles are deliberately NOT
 * reproduced here — branding writes are admin-only PATCH calls and this
 * phase displays the deployment's branding only. Offline (or any load
 * failure) shows "Branding unavailable offline" instead of stale values.
 *
 * Note the web fail-open rule (configRules.ts): a missing or unparsable
 * `included_modules` value means every module is included, so the screen
 * says so rather than showing an empty list.
 */
@Composable
fun WhiteLabelScreen(viewModel: WhiteLabelViewModel, onBack: () -> Unit) {
    LubricScreen(title = "White Label", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        Text(
            "Branding, modules, and feature flags for this deployment.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(16.dp))

        val state = viewModel.state
        if (state == null) {
            Text(if (viewModel.loading) "Loading…" else "Branding unavailable offline")
        } else if (state.error != null) {
            Text("Branding unavailable offline")
            ErrorText(state.error)
            Spacer(Modifier.height(12.dp))
            Button(onClick = { viewModel.refresh() }, enabled = !viewModel.loading) {
                Text(if (viewModel.loading) "Loading…" else "Retry")
            }
        } else {
            val branding = state.branding
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Branding", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    Text("App name: ${branding.appName}")
                    Text("Primary colour: ${branding.primaryColor}")
                    val swatch = colorFromHex(branding.primaryColor)
                    Spacer(Modifier.height(8.dp))
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .background(swatch ?: Color.Gray),
                    )
                    if (swatch == null) {
                        Text(
                            "Colour is not a valid hex value, so no swatch is shown.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text("Default branding: ${branding.defaultBranding ?: "Not set"}")
                }
            }
            Spacer(Modifier.height(12.dp))

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Included modules", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    val modules = branding.includedModules
                    if (modules == null) {
                        Text("All modules included (no manifest set).")
                    } else if (modules.isEmpty()) {
                        Text("No modules included.")
                    } else {
                        for (module in modules) {
                            Text("• $module")
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Feature flags", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    if (state.featureFlags.isEmpty()) {
                        Text(
                            "No feature flags.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        for (flag in state.featureFlags) {
                            Text(
                                "${flag.key}: " +
                                    if (flag.enabled) "Enabled" else "Disabled",
                            )
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
