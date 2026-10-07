package com.lubrcapp.lubrcapp.feature.auth

/** Modes for the onboarding flow. */
enum class AuthOnboardingMode {
    /** First launch - create a new business. */
    CREATE_BUSINESS,

    /** User already has an account - join an existing business. */
    JOIN_BUSINESS,

    /** Restore from backup. */
    RESTORE_BACKUP,

    /** Account recovery. */
    FORGOT_PASSWORD
}