package com.lubrcapp.lubrcapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.lubrcapp.lubrcapp.core.designsystem.LubrcappTheme
import com.lubrcapp.lubrcapp.feature.auth.AuthViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            LubrcappTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    MainNavigation(
                        onNavigateToAuth = { onboardingMode ->
                            AuthViewModel().showOnboarding(this@MainActivity, onboardingMode)
                        }
                    )
                }
            }
        }
    }
}

