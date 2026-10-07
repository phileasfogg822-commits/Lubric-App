package com.lubrcapp.lubrcapp.whitelist.config

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import com.lubrcapp.lubrcapp.core.cache.CacheService
import com.lubrcapp.lubrcapp.whitelist.branding.BrandingConfig
import com.lubrcapp.lubrcapp.whitelist.featureflags.FeatureFlagKeys
import com.lubrcapp.lubrcapp.whitelist.featureflags.FeatureFlagService
import com.lubrcapp.lubrcapp.whitelist.tenant.TenantService
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first

class WhiteLabelConfigServiceImpl(
    private val context: Context,
    private val cacheService: CacheService,
    private val dataStore: DataStore<Preferences>,
    private val tenantService: TenantService,
    private val featureFlagService: FeatureFlagService
) : WhiteLabelConfigService {

    private val deploymentConfigKey = "deployment_config"

    override suspend fun getDeploymentConfig(context: Context): Deferred<DeploymentConfig> {
        return coroutineScope {
            async(Dispatchers.IO) {
                val cached = cacheService.get<String>(deploymentConfigKey)
                if (cached != null) {
                    return@async parseDeploymentConfig(cached)
                }

                // Load from server via NetworkService
                val serverConfig = loadFromServer()
                cacheService.set(deploymentConfigKey, serverConfig)
                parseDeploymentConfig(serverConfig)
            }
        }
    }

    override suspend fun getMergedConfig(context: Context): Deferred<MergedConfig> {
        return coroutineScope {
            async(Dispatchers.IO) {
                val deployment = getDeploymentConfig(context).await()
                val userBranding = loadUserBranding()
                val themeMode = getThemeMode()
                val language = getLanguage()
                val features = featureFlagService.getEnabledFeatures().first()

                MergedConfig(
                    deployment = deployment,
                    userBranding = userBranding,
                    themeMode = themeMode,
                    language = language,
                    features = features
                )
            }
        }
    }

    override suspend fun refreshConfig(context: Context) {
        cacheService.remove(deploymentConfigKey)
        // Trigger server fetch
    }

    override fun isFeatureEnabled(feature: String): Boolean {
        return featureFlagService.isEnabled(feature)
    }

    override fun getAppName(): String {
        val config = cacheService.get<String>(deploymentConfigKey)
        return if (config != null) {
            parseDeploymentConfig(config).appName
        } else {
            "LubrcApp"
        }
    }

    override fun getPrimaryColor(): Int {
        val config = cacheService.get<String>(deploymentConfigKey)
        return if (config != null) {
            val deployment = parseDeploymentConfig(config)
            deployment.defaultBranding.primaryColor
        } else {
            0xFF6200EE.toInt()
        }
    }

    override fun useLightMode(): Boolean {
        return when (getThemeMode()) {
            ThemeMode.SYSTEM -> {
                // Use system default (dark theme follows system setting).
                // In production, read from UI mode night flags.
                // Default to light for now.
                false
            }
            ThemeMode.LIGHT -> true
            ThemeMode.DARK -> false
        }
    }

    override suspend fun getIncludedModules(): Set<String> {
        return featureFlagService.getEnabledFeatures().first()
    }

    private fun loadUserBranding(): BrandingConfig {
        // Load from DataStore
        return BrandingConfig()
    }

    private fun getThemeMode(): ThemeMode {
        // Load from DataStore
        return ThemeMode.SYSTEM
    }

    private fun getLanguage(): String {
        // Load from DataStore
        return "en"
    }

    private fun parseDeploymentConfig(json: String): DeploymentConfig {
        // Parse JSON - in production use Gson
        return DeploymentConfig(
            appName = "LubrcApp",
            packageName = "com.lubrcapp.lubrcapp",
            versionName = "1.0.0",
            versionCode = 1,
            apiEndpoint = "https://api.lubrcapp.com/",
            firebaseProjectId = "lubrcapp-dev",
            defaultBranding = BrandingConfig(),
            includedModules = setOf(
                FeatureFlagKeys.MODULE_INVENTORY,
                FeatureFlagKeys.MODULE_ORDERS,
                FeatureFlagKeys.MODULE_PURCHASES,
                FeatureFlagKeys.MODULE_PAYS,
                FeatureFlagKeys.MODULE_ACCOUNTING
            ),
            paymentGateways = emptyList(),
            supportEmail = null,
            supportPhone = null,
            termsUrl = null,
            privacyUrl = null,
            website = null,
            maintenanceMessage = null,
            minSupportedVersion = null
        )
    }

    private suspend fun loadFromServer(): String {
        // In production, fetch from API
        return "{}"
    }
}

