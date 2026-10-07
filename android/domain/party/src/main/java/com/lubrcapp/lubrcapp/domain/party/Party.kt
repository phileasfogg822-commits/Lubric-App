package com.lubrcapp.lubrcapp.domain.party

/**
 * Party entity - a customer or supplier (or both) of a business.
 */
data class Party(
    val id: String = "",
    val businessId: String = "",
    val type: PartyType = PartyType.CUSTOMER,
    val name: String = "",
    val phone: String? = null,
    val email: String? = null,
    val address: String? = null,
    val city: String? = null,
    val country: String? = null,
    val taxNumber: String? = null,
    val openingBalance: Double = 0.0,
    val currentBalance: Double = 0.0,
    val creditLimit: Double? = null,
    val isActive: Boolean = true,
    val notes: String? = null,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
)

enum class PartyType {
    CUSTOMER,
    SUPPLIER,
    BOTH,
}
