package app.lubric.desktop.data.branding

import app.lubric.desktop.data.network.ConfigRowDto
import app.lubric.desktop.data.network.FeatureFlagDto
import app.lubric.desktop.data.network.LubricApi
import com.google.gson.Gson

/** The white-label branding resolved from the config rows. */
data class Branding(
    val appName: String,
    val primaryColor: String,
    /** Raw `default_branding` value, or null when the key is absent. */
    val defaultBranding: String?,
    /**
     * Module keys from the `included_modules` config value, or null when the
     * value is missing or unparsable — the web rule (configRules.ts) treats
     * that as "everything included" (fail open), never as an empty manifest.
     */
    val includedModules: List<String>?,
)

/** What [BrandingRepository.loadBranding] returns, success or failure. */
data class BrandingState(
    val branding: Branding,
    val featureFlags: List<FeatureFlagDto>,
    /** Non-null when the network call failed; the screen shows the offline text. */
    val error: String?,
) {
    /** True when both calls succeeded. */
    val available: Boolean get() = error == null
}

/**
 * Pure config/flag rules, mirroring `src/lib/configRules.ts` and
 * `src/modules/settings/WhiteLabel.tsx` (useBranding, moduleList, pickFlag).
 * Kept free of Android so unit tests can exercise them on the JVM.
 */
object BrandingMapping {

    /** Web White Label save fallback (`appName.trim() || "LubricApp"`). */
    const val DEFAULT_APP_NAME = "LubricApp"

    /** Web White Label form default for the primary colour. */
    const val DEFAULT_PRIMARY_COLOR = "#2563EB"

    /**
     * Config rows -> branding. Missing/blank keys fall back to the defaults
     * above; `default_branding` stays null when absent; `included_modules`
     * is parsed as a JSON array of strings (null when missing/unparsable).
     */
    fun brandingFromConfig(rows: List<ConfigRowDto>): Branding {
        val byKey = rows.associate { it.key to it.value }
        return Branding(
            appName = byKey["app_name"]?.trim().takeIf { !it.isNullOrBlank() }
                ?: DEFAULT_APP_NAME,
            primaryColor = byKey["primary_color"]?.trim().takeIf { !it.isNullOrBlank() }
                ?: DEFAULT_PRIMARY_COLOR,
            defaultBranding = byKey["default_branding"],
            includedModules = parseIncludedModules(byKey["included_modules"]),
        )
    }

    /**
     * Parse the `included_modules` config value into a module-key list.
     * Returns null when the value is missing or not a usable JSON array —
     * the caller treats null as "everything included" (web moduleList).
     */
    fun parseIncludedModules(raw: String?): List<String>? {
        if (raw.isNullOrBlank()) return null
        return try {
            val parsed = Gson().fromJson(raw, Array<String>::class.java) ?: return null
            parsed.filter { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
    }

    /** Parse a bare JSON array of feature-flag rows (as GET /api/feature-flags returns). */
    fun parseFeatureFlags(json: String): List<FeatureFlagDto> {
        if (json.isBlank()) return emptyList()
        return try {
            Gson().fromJson(json, Array<FeatureFlagDto>::class.java)?.toList().orEmpty()
        } catch (_: Exception) {
            emptyList()
        }
    }

    /**
     * Resolve a flag across its global row and an optional per-outlet
     * override (web pickFlag). A shop-scoped row wins for that outlet;
     * otherwise the global (shop_id null) row, else the first row.
     * Unknown flag or no rows -> enabled (fail open, as seeded). Only an
     * explicit `false` turns a flag off.
     */
    fun flagEnabled(
        flags: List<FeatureFlagDto>,
        key: String,
        shopId: Int? = null,
    ): Boolean {
        val matches = flags.filter { it.key == key }
        if (matches.isEmpty()) return true
        if (shopId != null) {
            val scoped = matches.find { it.shopId == shopId }
            if (scoped != null) return scoped.enabled
        }
        val global = matches.find { it.shopId == null }
        val row = global ?: matches.first()
        return row.enabled
    }
}

/**
 * White-label branding from the hub: GET /api/config (public branding keys
 * + included_modules) and GET /api/feature-flags.
 *
 * Never throws to the UI: on any network failure it returns the defaults
 * with [BrandingState.error] set, and the screen shows
 * "Branding unavailable offline". The two calls are attempted independently,
 * so a config failure does not hide flags that did load (and vice versa).
 */
class BrandingRepository(private val api: LubricApi) {

    suspend fun loadBranding(): BrandingState {
        var configError: String? = null
        var flagsError: String? = null

        val branding = try {
            BrandingMapping.brandingFromConfig(api.config())
        } catch (e: Exception) {
            configError = e.message ?: "Could not load branding"
            BrandingMapping.brandingFromConfig(emptyList())
        }

        val flags = try {
            api.featureFlags()
        } catch (e: Exception) {
            flagsError = e.message ?: "Could not load feature flags"
            emptyList()
        }

        return BrandingState(
            branding = branding,
            featureFlags = flags,
            error = configError ?: flagsError,
        )
    }
}
