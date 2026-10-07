package com.lubrcapp.lubrcapp.domain.user

/**
 * User entity (belongs to one or more businesses with a role each).
 */
data class User(
    val id: String = "",
    val businessId: String = "",
    val name: String = "",
    val phone: String = "",
    val email: String? = null,
    val role: String = "VIEWER",
    val permissions: Set<String> = emptySet(),
    val isActive: Boolean = true,
    val lastLoginAt: Long? = null,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
)
