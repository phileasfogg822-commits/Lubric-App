package com.lubrcapp.lubrcapp.domain.item

/**
 * Item (product) entity sold or used by a business.
 */
data class Item(
    val id: String = "",
    val businessId: String = "",
    val name: String = "",
    val sku: String? = null,
    val barcode: String? = null,
    val description: String? = null,
    val category: String? = null,
    val brand: String? = null,
    val unit: String = "pcs",
    val purchasePrice: Double = 0.0,
    val salePrice: Double = 0.0,
    val taxRate: Double = 0.0,
    val hasBatchTracking: Boolean = false,
    val hasSerialTracking: Boolean = false,
    val reorderLevel: Double = 0.0,
    val isStockTracked: Boolean = true,
    val isActive: Boolean = true,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
)
