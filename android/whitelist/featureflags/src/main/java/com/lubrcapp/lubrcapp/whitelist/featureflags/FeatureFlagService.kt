package com.lubrcapp.lubrcapp.whitelist.featureflags

import android.content.Context
import kotlinx.coroutines.flow.Flow

/**
 * Feature flag / feature toggle service.
 *
 * Admin-controlled toggles for hiding unused modules.
 * Configured from server-side remote config and cached locally.
 */
interface FeatureFlagService {
    /**
     * Check if a feature is enabled.
     */
    fun isEnabled(feature: String): Boolean

    /**
     * Get all enabled features.
     */
    fun getEnabledFeatures(): Flow<Set<String>>

    /**
     * Check if a module is enabled.
     */
    fun isModuleEnabled(module: String): Boolean

    /**
     * Check if dashboard widgets are configurable.
     */
    fun isDashboardWidgetsConfigurable(): Boolean

    /**
     * Check if the online store feature is enabled.
     */
    fun isOnlineStoreEnabled(): Boolean

    /**
     * Check if barcode scanning is enabled.
     */
    fun isBarcodeScanningEnabled(): Boolean

    /**
     * Check if thermal printing is enabled.
     */
    fun isThermalPrintingEnabled(): Boolean

    /**
     * Check if multi-branch is enabled.
     */
    fun isMultiBranchEnabled(): Boolean

    /**
     * Check if accounting is enabled.
     */
    fun isAccountingEnabled(): Boolean

    /**
     * Check if reports are enabled.
     */
    fun isReportingEnabled(): Boolean

    /**
     * Check if user management is enabled.
     */
    fun isUserManagementEnabled(): Boolean

    /**
     * Check if backup/restore is enabled.
     */
    fun isBackupEnabled(): Boolean

    /**
     * Check if synchronization is enabled.
     */
    fun isSyncEnabled(): Boolean

    /**
     * Check if notifications are enabled.
     */
    fun isNotificationsEnabled(): Boolean

    /**
     * Check if field sales mode is enabled.
     */
    fun isFieldSalesEnabled(): Boolean

    /**
     * Get all available feature flag keys.
     */
    fun getAllFeatureKeys(): List<String>
}

object FeatureFlagKeys {
    const val MODULE_INVENTORY = "inventory"
    const val MODULE_ORDERS = "orders"
    const val MODULE_PURCHASES = "purchases"
    const val MODULE_PAYS = "pays"
    const val MODULE_ACCOUNTING = "accounting"
    const val MODULE_REPORTS = "reports"
    const val MODULE_USERS = "users"
    const val MODULE_SYNC = "sync"
    const val MODULE_BACKUP = "backup"
    const val MODULE_NOTIFICATIONS = "notifications"
    const val MODULE_PRINTING = "printing"
    const val MODULE_FIELD_SALES = "field_sales"
    const val MODULE_ONLINE_STORE = "online_store"
    const val MODULE_BATCH_TRACKING = "batch_tracking"
    const val MODULE_SERIAL_TRACKING = "serial_tracking"
    const val MODULE_MULTI_BRANCH = "multi_branch"
    const val MODULE_ROUTES = "routes"
    const val MODULE_DELIVERY = "delivery"
    const val MODULE_PAYMENT_REMINDERS = "payment_reminders"
    const val MODULE_BARCODES = "barcodes"
    const val MODULE_RETURNS = "returns"
    const val MODULE_EXPENSES = "expenses"
    const val MODULE_OTHER_INCOME = "other_income"
    const val MODULE_CASH_BANK = "cash_bank"
    const val MODULE_TAX = "tax"
    const val MODULE_TRANSLATION = "translation"
}

