package com.lubrcapp.lubrcapp.whitelist.config

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import com.lubrcapp.lubrcapp.core.cache.CacheService
import com.lubrcapp.lubrcapp.whitelist.branding.BrandingConfig
import com.lubrcapp.lubrcapp.whitelist.branding.BrandingConfig
import com.lubrcapp.lubrcapp.whitelist.featureflags.FeatureFlagKeys
import com.lubrcapp.lubrcapp.whitelist.featureflags.FeatureFlagService
import com.lubrcapp.lubrcapp.whitelist.tenant.TenantService
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

class WhiteLabelConfigServiceImpl(
    private val context: Context,
    private val cacheService: CacheService,
    private val dataStore: DataStore<Preferences>,
    private val tenantService: TenantService,
    private val featureFlagService: FeatureFlagService
) : WhiteLabelConfigService {

    private val DEPLOYMENT_CONFIG_KEY = "deployment_config"

    override suspend fun getDeploymentConfig(context: Context): Deferred<DeploymentConfig> {
        return kotlinx.coroutines.async(context.coroutineContext) {
            val cached = cacheService.get<String>(DEPLOYMENT_CONFIG_KEY)
            if (cached != null) {
                return@async parseDeploymentConfig(cached)
            }

            // Load from server via NetworkService
            val serverConfig = loadFromServer()
            cacheService.set(DEPLOYMENT_CONFIG_KEY, serverConfig.toString())
            parseDeploymentConfig(serverConfig)
        }
    }

    override suspend fun getMergedConfig(context: Context): Deferred<MergedConfig> {
        return kotlinx.coroutines.async(context.coroutineContext) {
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

    override suspend fun refreshConfig(context: Context) {
        cacheService.set(DEPLOYMENT_CONFIG_KEY, null)
        // Trigger server fetch
    }

    override fun isFeatureEnabled(feature: String): Boolean {
        return featureFlagService.isEnabled(feature)
    }

    override fun getAppName(): String {
        val config = cacheService.get<String>(DEPLOYMENT_CONFIG_KEY)
        return if (config != null) {
            parseDeploymentConfig(config).appName
        } else {
            "LubrcApp"
        }
    }

    override fun getPrimaryColor(): Int {
        val config = cacheService.get<String>(DEPLOYMENT_CONFIG_KEY)
        return if (config != null) {
            val deployment = parseDeploymentConfig(config)
            deployment.defaultBranding.primaryColor
        } else {
            0xFF6200EE
        }
    }

    override fun useLightMode(): Boolean {
        val config = cacheService.get<String>(DEPLOYMENT_CONFIG_KEY)
        return when (getThemeMode()) {
            ThemeMode.SYSTEM -> {
                // Use system default
                android.provider.Settings.Global.getString(
                    context.contentResolver,
                    android.provider.Settings.Global.ACCELEROMETER_ROTATION
                ) != null
            }
            ThemeMode.LIGHT -> true
            ThemeMode.DARK -> false
        }
    }

    override fun getIncludedModules(): Set<String> {
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

