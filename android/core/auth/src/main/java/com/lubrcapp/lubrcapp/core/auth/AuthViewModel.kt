package com.lubrcapp.lubrcapp.core.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import com.lubrcapp.lubrcapp.feature.auth.AuthOnboardingMode
import com.lubrcapp.lubrcapp.feature.auth.OnboardingScreen

class AuthViewModel : ViewModel() {
    fun showOnboarding(context: Context, mode: AuthOnboardingMode) {
        OnboardingScreen.show(context, mode)
    }
}

