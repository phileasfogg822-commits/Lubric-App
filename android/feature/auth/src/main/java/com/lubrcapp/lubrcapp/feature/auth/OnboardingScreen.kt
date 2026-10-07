package com.lubrcapp.lubrcapp.feature.auth

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/**
 * Onboarding entry screen.
 *
 * Rendered from a composable context (e.g. driven by [AuthViewModel.onboardingMode]).
 */
object OnboardingScreen {
    @Composable
    fun Content(mode: AuthOnboardingMode) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text(text = "Onboarding - $mode")
        }
    }
}