package com.lubrcapp.lubrcapp.domain.business

/**
 * Business (tenant) entity.
 *
 * Each business is an isolated tenant: every other domain entity
 * (parties, items, sales, ...) is scoped to a businessId.
 */
data class Business(
    val id: String = "",
    val name: String = "",
    val businessType: String = "",
    val phone: String = "",
    val email: String = "",
    val address: String = "",
    val country: String = "",
    val postalCode: String = "",
    val website: String = "",
    val taxNumber: String? = null,
    val currency: String = "USD",
    val timezone: String = "UTC",
    val inviteCode: String? = null,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
)
