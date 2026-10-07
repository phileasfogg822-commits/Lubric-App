package com.lubrcapp.lubrcapp.feature.auth

import android.content.Context
import androidx.lifecycle.ViewModel

class AuthViewModel : ViewModel() {

    /** Mode of the onboarding flow that should be shown next. */
    var onboardingMode: AuthOnboardingMode? = null
        private set

    fun showOnboarding(context: Context, mode: AuthOnboardingMode) {
        // The context is kept for flows that need an Activity (e.g. launching
        // a dedicated onboarding Activity); state is exposed via onboardingMode
        // so composables can render OnboardingScreen.Content(mode).
        onboardingMode = mode
    }
}