package app.lubric.desktop.ui.common

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.lubric.desktop.data.sync.SyncStatus

/**
 * Shared Phase 1 chrome: a top bar with an optional text back button and a
 * vertically scrollable, width-constrained column, so the same screens read
 * well on a phone and on a wide tablet. No icon dependency is used (the
 * project has no material-icons artifact); back navigation is a text button.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LubricScreen(
    title: String,
    onBack: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    if (onBack != null) {
                        TextButton(onClick = onBack) { Text("‹ Back") }
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Column(modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth()) {
                content()
            }
        }
    }
}

/** Plain-language label for a [SyncStatus]; "Up to date" is the idle state. */
fun syncStatusLabel(status: SyncStatus): String = when (status) {
    SyncStatus.OFFLINE -> "Offline"
    SyncStatus.SYNCING -> "Syncing…"
    SyncStatus.IDLE -> "Up to date"
    SyncStatus.ERROR -> "Error"
}

/** Error line shown under a form or action; renders nothing when blank. */
@Composable
fun ErrorText(text: String?) {
    if (!text.isNullOrBlank()) {
        Text(
            text = text,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
        )
    }
}
