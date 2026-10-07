package com.lubrcapp.lubrcapp.domain.payment

/**
 * Payment against a sales invoice, purchase invoice, or party balance.
 */
data class Payment(
    val id: String = "",
    val businessId: String = "",
    val partyId: String = "",
    val direction: PaymentDirection = PaymentDirection.RECEIVED,
    val method: PaymentMethod = PaymentMethod.CASH,
    val amount: Double = 0.0,
    val referenceNumber: String? = null,
    val relatedInvoiceId: String? = null,
    val date: Long = 0L,
    val notes: String? = null,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
)

enum class PaymentDirection {
    RECEIVED,
    PAID,
}

enum class PaymentMethod {
    CASH,
    BANK_TRANSFER,
    CHEQUE,
    CARD,
    MOBILE_WALLET,
    OTHER,
}
