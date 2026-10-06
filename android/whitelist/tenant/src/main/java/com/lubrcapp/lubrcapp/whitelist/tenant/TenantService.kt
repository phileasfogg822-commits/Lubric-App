package com.lubrcapp.lubrcapp.whitelist.tenant

import android.content.Context
import com.lubrcapp.lubrcapp.domain.business.Business
import com.lubrcapp.lubrcapp.domain.user.User

/**
 * Tenant / multi-business service.
 *
 * Manages the current business context, user authentication,
 * and business switcher functionality.
 *
 * Per business:
 * - Parties
 * - Products
 * - Inventory
 * - Sales
 * - Purchases
 * - Payments
 * - Accounts
 * - Users
 * - Reports
 * - Number sequences
 */
interface TenantService {
    /**
     * Get the currently active business (null for pre-auth).
     */
    fun getCurrentBusiness(): Business?

    /**
     * Switch to a different business.
     */
    suspend fun switchBusiness(context: Context, business: Business)

    /**
     * Check if user has access to this business.
     */
    fun hasAccess(business: Business): Boolean

    /**
     * Get the current user.
     */
    fun getCurrentUser(): User?

    /**
     * Get available businesses for the current user.
     */
    fun getAvailableBusinesses(): List<Business>

    /**
     * Create a new business.
     */
    suspend fun createBusiness(
        context: Context,
        name: String,
        businessType: String,
        phone: String,
        email: String,
        address: String,
        country: String,
        postalCode: String,
        website: String
    ): Result<Business>

    /**
     * Join an existing business.
     */
    suspend fun joinBusiness(
        context: Context,
        inviteCode: String,
        phone: String,
        email: String,
        businessName: String
    ): Result<Business>

    /**
     * Restore a backup.
     */
    suspend fun restoreBackup(context: Context, backupId: String): Result<Unit>

    /**
     * Check if user is an owner/admin.
     */
    fun isOwnerOrAdmin(): Boolean

    /**
     * Check if user has a specific role.
     */
    fun hasRole(role: String): Boolean

    /**
     * Get the current user's roles.
     */
    fun getUserRoles(): Set<String>

    /**
     * Get the current user's permissions.
     */
    fun getUserPermissions(): Set<String>

    /**
     * Check if a user has a specific permission.
     */
    fun hasPermission(permission: String): Boolean
}

enum class BusinessType {
    RETAIL, WHOLESALE, DISTRIBUTOR, SERVICES, MANUFACTURING,
    PHARMACY, GROCERY, RESTAURANT, AUTO_PARTS, LUBRICANTS,
    ELECTRONICS, CLOTHING, OTHER
}

