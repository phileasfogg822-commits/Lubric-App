package com.lubrcapp.lubrcapp.domain.sales

/**
 * Sales invoice header.
 */
data class SalesInvoice(
    val id: String = "",
    val businessId: String = "",
    val partyId: String = "",
    val invoiceNumber: String = "",
    val date: Long = 0L,
    val dueDate: Long? = null,
    val status: SalesStatus = SalesStatus.DRAFT,
    val subtotal: Double = 0.0,
    val taxTotal: Double = 0.0,
    val discount: Double = 0.0,
    val total: Double = 0.0,
    val paidAmount: Double = 0.0,
    val notes: String? = null,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
) {
    val balanceDue: Double
        get() = total - paidAmount
}

/**
 * Line item on a sales invoice.
 */
data class SalesInvoiceLine(
    val id: String = "",
    val invoiceId: String = "",
    val itemId: String = "",
    val description: String = "",
    val quantity: Double = 1.0,
    val unitPrice: Double = 0.0,
    val taxRate: Double = 0.0,
    val discount: Double = 0.0,
    val lineTotal: Double = 0.0,
)

enum class SalesStatus {
    DRAFT,
    SENT,
    PAID,
    PARTIALLY_PAID,
    OVERDUE,
    CANCELLED,
}
