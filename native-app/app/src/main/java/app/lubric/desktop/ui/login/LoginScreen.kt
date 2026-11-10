package app.lubric.desktop.ui.login

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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.auth.AuthRepository
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch

/**
 * Sign-in. Navigation on success is not done here: a successful login
 * updates [AuthRepository.session], which the NavHost observes and uses to
 * move to pairing or home. The password is never logged or displayed.
 */
class LoginViewModel(private val authRepository: AuthRepository) : ViewModel() {

    var email by mutableStateOf("")
        private set
    var password by mutableStateOf("")
        private set
    var emailError by mutableStateOf<String?>(null)
        private set
    var passwordError by mutableStateOf<String?>(null)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set

    fun onEmailChange(value: String) {
        email = value
        emailError = null
        errorMessage = null
    }

    fun onPasswordChange(value: String) {
        password = value
        passwordError = null
        errorMessage = null
    }

    fun login() {
        val trimmedEmail = email.trim()
        var valid = true
        if (trimmedEmail.isEmpty()) {
            emailError = "Enter your email"
            valid = false
        }
        if (password.isEmpty()) {
            passwordError = "Enter your password"
            valid = false
        }
        if (!valid) return
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            authRepository.login(trimmedEmail, password)
                .onFailure { errorMessage = it.message ?: "Sign-in failed. Try again." }
            isLoading = false
        }
    }
}

@Composable
fun LoginScreen(viewModel: LoginViewModel) {
    LubricScreen(title = "Sign in") {
        Spacer(Modifier.height(24.dp))
        Text("Lubric POS", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Sign in with your shop account to continue.",
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = viewModel.email,
            onValueChange = viewModel::onEmailChange,
            label = { Text("Email") },
            singleLine = true,
            isError = viewModel.emailError != null,
            supportingText = viewModel.emailError?.let { message -> { Text(message) } },
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next
            ),
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = viewModel.password,
            onValueChange = viewModel::onPasswordChange,
            label = { Text("Password") },
            singleLine = true,
            isError = viewModel.passwordError != null,
            supportingText = viewModel.passwordError?.let { message -> { Text(message) } },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done
            ),
            keyboardActions = KeyboardActions(onDone = { viewModel.login() }),
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { viewModel.login() },
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
                Text("Sign in")
            }
        }
        ErrorText(viewModel.errorMessage)
        Spacer(Modifier.height(16.dp))
        Text(
            "Your password is never stored on this device.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
