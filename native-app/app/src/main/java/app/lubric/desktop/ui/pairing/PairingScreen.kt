package app.lubric.desktop.ui.pairing

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.sync.SyncRepository
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

/**
 * Device pairing with the one-time 8-character code created in the shop's
 * web app. Navigation on success is not done here: a successful pair stores
 * the device token, which the NavHost observes and uses to move to home.
 */
class PairingViewModel(private val syncRepository: SyncRepository) : ViewModel() {

    var code by mutableStateOf("")
        private set
    var codeError by mutableStateOf<String?>(null)
        private set
    var deviceName by mutableStateOf("Lubric POS")
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set

    /** Upper-cases as typed and caps at 8 characters; validation happens in [pair]. */
    fun onCodeChange(raw: String) {
        code = raw.uppercase().take(8)
        codeError = null
        errorMessage = null
    }

    fun onDeviceNameChange(value: String) {
        deviceName = value
        errorMessage = null
    }

    fun pair() {
        if (!CODE_REGEX.matches(code)) {
            codeError = "The code is 8 letters and numbers"
            return
        }
        val name = deviceName.trim().ifEmpty { "Lubric POS" }
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            syncRepository.pair(code, name)
                .onFailure { errorMessage = it.message ?: "Pairing failed. Check the code and try again." }
            isLoading = false
        }
    }

    companion object {
        /** Server codes are 8 uppercase hex characters (see survey §5.5). */
        private val CODE_REGEX = Regex("^[0-9A-F]{8}$")
    }
}

@Composable
fun PairingScreen(viewModel: PairingViewModel) {
    LubricScreen(title = "Pair this device") {
        Spacer(Modifier.height(24.dp))
        Text(
            "Enter the 8-letter code from the shop's web app: Shop Settings → " +
                "Phones & Devices → Add a phone.",
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = viewModel.code,
            onValueChange = viewModel::onCodeChange,
            label = { Text("Pairing code") },
            singleLine = true,
            isError = viewModel.codeError != null,
            supportingText = viewModel.codeError?.let { message -> { Text(message) } },
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                keyboardType = KeyboardType.Ascii,
                imeAction = ImeAction.Next
            ),
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = viewModel.deviceName,
            onValueChange = viewModel::onDeviceNameChange,
            label = { Text("Device name") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Words,
                imeAction = ImeAction.Done
            ),
            keyboardActions = KeyboardActions(onDone = { viewModel.pair() }),
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { viewModel.pair() },
            enabled = !viewModel.isLoading,
            modifier = Modifier.fillMaxWidth()
        ) {
            if (viewModel.isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp
                )
            } else {
                Text("Pair this device")
            }
        }
        ErrorText(viewModel.errorMessage)
        Spacer(Modifier.height(16.dp))
        Text(
            "The code works once and expires after 24 hours. If it has already " +
                "been used, ask the shop to create a new one.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
