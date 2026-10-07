package com.lubrcapp.lubrcapp.whitelist.config

import android.content.Context
import com.lubrcapp.lubrcapp.whitelist.branding.BrandingConfig
import kotlinx.coroutines.Deferred

/**
 * White-label configuration service.
 *
 * Handles deployment-level customization:
 * - App name, icon, splash screen
 * - Package name, version
 * - API endpoint, Firebase project
 * - Default branding (colors, fonts, logos)
 * - Included modules
 * - Firebase project
 *
 * This service loads config from:
 * 1. Server (remote config)
 * 2. Local storage (cached)
 * 3. Build-time defaults
 */
interface WhiteLabelConfigService {
    /**
     * Get deployment configuration.
     */
    suspend fun getDeploymentConfig(context: Context): Deferred<DeploymentConfig>

    /**
     * Get merged config (server + local + defaults).
     */
    suspend fun getMergedConfig(context: Context): Deferred<MergedConfig>

    /**
     * Update config (e.g., after business switch).
     */
    suspend fun refreshConfig(context: Context)

    /**
     * Check if a feature is enabled.
     */
    fun isFeatureEnabled(feature: String): Boolean

    /**
     * Get the configured app name.
     */
    fun getAppName(): String

    /**
     * Get the configured primary color.
     */
    fun getPrimaryColor(): Int

    /**
     * Check if the app should use light mode.
     */
    fun useLightMode(): Boolean

    /**
     * Get included modules (feature toggles).
     */
    suspend fun getIncludedModules(): Set<String>
}

data class DeploymentConfig(
    val appName: String,
    val packageName: String,
    val versionName: String,
    val versionCode: Int,
    val apiEndpoint: String,
    val firebaseProjectId: String,
    val defaultBranding: BrandingConfig,
    val includedModules: Set<String>,
    val paymentGateways: List<String>,
    val supportEmail: String?,
    val supportPhone: String?,
    val termsUrl: String?,
    val privacyUrl: String?,
    val website: String?,
    val maintenanceMessage: String?,
    val minSupportedVersion: String?,
)

data class MergedConfig(
    val deployment: DeploymentConfig,
    val userBranding: BrandingConfig,
    val themeMode: ThemeMode,
    val language: String,
    val features: Set<String>,
)

enum class ThemeMode { LIGHT, DARK, SYSTEM }

enum class AuthOnboardingMode { CREATE, JOIN, NONE }

enum class BusinessRole { OWNER, ADMIN, MANAGER, ACCOUNTANT, CASHIER, VIEWER, CUSTOM }

