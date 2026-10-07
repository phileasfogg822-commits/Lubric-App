package com.lubrcapp.lubrcapp.core.ui

import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import com.lubrcapp.lubrcapp.core.designsystem.LubrcappTheme
import com.lubrcapp.lubrcapp.feature.auth.AuthOnboardingMode

@Composable
fun MainNavigation(
    onNavigateToAuth: (AuthOnboardingMode) -> Unit
) {
    LubrcappTheme {
        Scaffold(
            bottomBar = {
                // Bottom navigation will be populated based on navigation state
            }
        ) { paddingValues ->
            // Main content area. The actual screen is provided via Navigation composable or state.
        }
    }
}

