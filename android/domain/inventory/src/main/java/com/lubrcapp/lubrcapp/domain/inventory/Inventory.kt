package com.lubrcapp.lubrcapp.domain.inventory

/**
 * Stock level of an item in a warehouse/location.
 */
data class StockLevel(
    val id: String = "",
    val businessId: String = "",
    val itemId: String = "",
    val warehouseId: String = "",
    val quantity: Double = 0.0,
    val reservedQuantity: Double = 0.0,
    val batchNumber: String? = null,
    val serialNumber: String? = null,
    val expiryDate: Long? = null,
    val updatedAt: Long = 0L,
) {
    val availableQuantity: Double
        get() = quantity - reservedQuantity
}

/**
 * Warehouse / stock location.
 */
data class Warehouse(
    val id: String = "",
    val businessId: String = "",
    val name: String = "",
    val isDefault: Boolean = false,
    val isActive: Boolean = true,
)
