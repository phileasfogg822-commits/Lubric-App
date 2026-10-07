package com.lubrcapp.lubrcapp.domain.accounting

/**
 * Chart of accounts entry.
 */
data class Account(
    val id: String = "",
    val businessId: String = "",
    val code: String = "",
    val name: String = "",
    val type: AccountType = AccountType.ASSET,
    val parentId: String? = null,
    val balance: Double = 0.0,
    val isActive: Boolean = true,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
)

/**
 * Double-entry journal entry.
 */
data class JournalEntry(
    val id: String = "",
    val businessId: String = "",
    val date: Long = 0L,
    val description: String = "",
    val referenceNumber: String? = null,
    val lines: List<JournalLine> = emptyList(),
    val createdAt: Long = 0L,
)

data class JournalLine(
    val id: String = "",
    val entryId: String = "",
    val accountId: String = "",
    val debit: Double = 0.0,
    val credit: Double = 0.0,
    val memo: String? = null,
)

enum class AccountType {
    ASSET,
    LIABILITY,
    EQUITY,
    INCOME,
    EXPENSE,
}
